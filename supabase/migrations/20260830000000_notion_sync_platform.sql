-- Phase 8: Notion Knowledge Integration platform migration
-- Implements owner-scoped notion_page_links, notion_sync_conflicts, sync lease support,
-- audit change tracking, and security-invoker synchronization RPCs.

-- 1. Extend sync_runs with lease expiry
alter table public.sync_runs
  add column if not exists lease_expires_at timestamptz;

-- 2. Extend sync_changes with link reference, details, and change types
alter table public.sync_changes
  add column if not exists notion_page_link_id uuid,
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.sync_changes
  drop constraint if exists sync_changes_type;

alter table public.sync_changes
  add constraint sync_changes_type check (
    change_type in (
      'created', 'updated', 'unchanged', 'missing', 'ambiguous', 'failed',
      'pushed', 'imported', 'conflict', 'unsupported', 'relinked', 'skipped'
    )
  );

-- 3. Create notion_page_links table
create table if not exists public.notion_page_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.integration_accounts(id) on delete restrict,
  note_id uuid not null references public.notes(id) on delete restrict,
  workspace_id text not null,
  remote_page_id text not null,
  remote_root_block_id text,
  remote_url text not null,
  direction text not null default 'forward_to_notion',
  converter_version integer not null default 1,
  base_snapshot jsonb,
  base_local_fingerprint text,
  base_remote_fingerprint text,
  last_observed_local_fingerprint text,
  last_observed_remote_fingerprint text,
  last_pushed_fingerprint text,
  last_remote_revision text,
  active_attempt_id uuid,
  pending_attempt_id uuid,
  pending_root_block_id text,
  status text not null default 'linked',
  last_error_code text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notion_page_links_direction check (direction in ('forward_to_notion', 'selective_two_way')),
  constraint notion_page_links_status check (
    status in (
      'linked', 'synced', 'local_pending', 'remote_pending', 'syncing',
      'conflict', 'unsupported', 'upgrade_review', 'cleanup_pending',
      'remote_missing', 'remote_structure_changed', 'local_archived',
      'error', 'disconnected', 'attention', 'retired'
    )
  )
);

-- Foreign key on sync_changes to notion_page_links
alter table public.sync_changes
  drop constraint if exists sync_changes_notion_page_link_id_fkey;

alter table public.sync_changes
  add constraint sync_changes_notion_page_link_id_fkey
  foreign key (notion_page_link_id) references public.notion_page_links(id) on delete set null;

-- Partial unique indexes on notion_page_links
create unique index if not exists notion_page_links_owner_note_unique
  on public.notion_page_links (user_id, note_id)
  where retired_at is null;

create unique index if not exists notion_page_links_account_remote_page_unique
  on public.notion_page_links (account_id, remote_page_id)
  where retired_at is null;

create index if not exists notion_page_links_owner_status_attempt_idx
  on public.notion_page_links (user_id, status, last_attempt_at desc);

create index if not exists sync_changes_notion_link_idx
  on public.sync_changes (notion_page_link_id, created_at desc)
  where notion_page_link_id is not null;

-- 4. Create notion_sync_conflicts table
create table if not exists public.notion_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  link_id uuid not null references public.notion_page_links(id) on delete restrict,
  base_snapshot jsonb not null,
  local_snapshot jsonb not null,
  remote_snapshot jsonb not null,
  base_fingerprint text not null,
  local_fingerprint text not null,
  remote_fingerprint text not null,
  remote_revision text not null,
  status text not null default 'open',
  resolution text,
  resolved_fingerprint text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notion_sync_conflicts_status check (status in ('open', 'resolved')),
  constraint notion_sync_conflicts_resolution check (resolution is null or resolution in ('keep_redline', 'use_notion'))
);

create unique index if not exists notion_sync_conflicts_one_open_per_link
  on public.notion_sync_conflicts (link_id)
  where status = 'open';

create index if not exists notion_sync_conflicts_owner_status_created_idx
  on public.notion_sync_conflicts (user_id, status, created_at desc);

-- 5. Updated_at triggers
create trigger notion_page_links_updated
  before update on public.notion_page_links
  for each row execute function public.set_updated_at();

create trigger notion_sync_conflicts_updated
  before update on public.notion_sync_conflicts
  for each row execute function public.set_updated_at();

-- 6. Owner equality triggers
create or replace function public.enforce_notion_page_link_relationship_owner()
returns trigger
language plpgsql
security invoker
as $$
declare
  account_owner uuid;
  note_owner uuid;
begin
  select user_id into account_owner from public.integration_accounts where id = new.account_id;
  if account_owner is null or account_owner <> new.user_id then
    raise exception 'Integration account must belong to the notion page link owner';
  end if;

  select user_id into note_owner from public.notes where id = new.note_id;
  if note_owner is null or note_owner <> new.user_id then
    raise exception 'Note must belong to the notion page link owner';
  end if;

  return new;
end;
$$;

create trigger notion_page_link_relationship_owner_check
  before insert or update on public.notion_page_links
  for each row execute function public.enforce_notion_page_link_relationship_owner();

create or replace function public.enforce_notion_sync_conflict_relationship_owner()
returns trigger
language plpgsql
security invoker
as $$
declare
  link_owner uuid;
begin
  select user_id into link_owner from public.notion_page_links where id = new.link_id;
  if link_owner is null or link_owner <> new.user_id then
    raise exception 'Notion page link must belong to the conflict owner';
  end if;

  return new;
end;
$$;

create trigger notion_sync_conflict_relationship_owner_check
  before insert or update on public.notion_sync_conflicts
  for each row execute function public.enforce_notion_sync_conflict_relationship_owner();

-- 7. Note update trigger (marks active links local_pending when note is updated outside import)
create or replace function public.mark_notion_link_local_pending_on_note_update()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- Only mark pending if title or body changed
  if (new.title is distinct from old.title) or (new.body is distinct from old.body) then
    update public.notion_page_links
    set status = 'local_pending'
    where note_id = new.id
      and user_id = new.user_id
      and retired_at is null
      and status in ('synced', 'remote_pending');
  end if;
  return new;
end;
$$;

create trigger note_notion_link_local_pending_trigger
  after update on public.notes
  for each row execute function public.mark_notion_link_local_pending_on_note_update();

-- 8. Row Level Security policies
alter table public.notion_page_links enable row level security;
alter table public.notion_sync_conflicts enable row level security;

create policy notion_page_links_select_own on public.notion_page_links
  for select to authenticated using ((select auth.uid()) = user_id);

create policy notion_page_links_insert_own on public.notion_page_links
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy notion_page_links_update_own on public.notion_page_links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy notion_page_links_delete_own on public.notion_page_links
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy notion_sync_conflicts_select_own on public.notion_sync_conflicts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy notion_sync_conflicts_insert_own on public.notion_sync_conflicts
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy notion_sync_conflicts_update_own on public.notion_sync_conflicts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy notion_sync_conflicts_delete_own on public.notion_sync_conflicts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 9. Atomic Compare-And-Swap RPCs for safe sync transitions

-- Apply Remote Import atomically
create or replace function public.notion_apply_remote_import(
  p_link_id uuid,
  p_title text,
  p_body text,
  p_base_snapshot jsonb,
  p_local_fp text,
  p_remote_fp text,
  p_remote_revision text
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  link_row public.notion_page_links%rowtype;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into link_row
  from public.notion_page_links
  where id = p_link_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Notion page link not found';
  end if;

  if link_row.retired_at is not null then
    raise exception 'Cannot import into a retired link';
  end if;

  -- Update note directly
  update public.notes
  set title = p_title,
      body = p_body,
      updated_at = now()
  where id = link_row.note_id and user_id = actor_id;

  -- Update link baselines and set synced
  update public.notion_page_links
  set base_snapshot = p_base_snapshot,
      base_local_fingerprint = p_local_fp,
      base_remote_fingerprint = p_remote_fp,
      last_observed_local_fingerprint = p_local_fp,
      last_observed_remote_fingerprint = p_remote_fp,
      last_remote_revision = p_remote_revision,
      status = 'synced',
      last_error_code = null,
      last_attempt_at = now(),
      last_success_at = now()
  where id = link_row.id;

  return jsonb_build_object('ok', true, 'link_id', link_row.id);
end;
$$;

-- Resolve Conflict atomically
create or replace function public.notion_resolve_conflict(
  p_conflict_id uuid,
  p_resolution text,
  p_new_title text,
  p_new_body text,
  p_new_snapshot jsonb,
  p_new_fp text,
  p_remote_revision text
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  conflict_row public.notion_sync_conflicts%rowtype;
  link_row public.notion_page_links%rowtype;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_resolution not in ('keep_redline', 'use_notion') then
    raise exception 'Invalid resolution choice';
  end if;

  select * into conflict_row
  from public.notion_sync_conflicts
  where id = p_conflict_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Conflict not found';
  end if;

  if conflict_row.status <> 'open' then
    raise exception 'Conflict is already resolved';
  end if;

  select * into link_row
  from public.notion_page_links
  where id = conflict_row.link_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Notion page link not found';
  end if;

  if p_resolution = 'use_notion' then
    -- Update note content
    update public.notes
    set title = p_new_title,
        body = p_new_body,
        updated_at = now()
    where id = link_row.note_id and user_id = actor_id;

    -- Advance link baselines to imported version
    update public.notion_page_links
    set base_snapshot = p_new_snapshot,
        base_local_fingerprint = p_new_fp,
        base_remote_fingerprint = p_new_fp,
        last_observed_local_fingerprint = p_new_fp,
        last_observed_remote_fingerprint = p_new_fp,
        last_remote_revision = p_remote_revision,
        status = 'synced',
        last_error_code = null,
        last_attempt_at = now(),
        last_success_at = now()
    where id = link_row.id;
  else
    -- keep_redline: mark link local_pending so it will be pushed to Notion
    update public.notion_page_links
    set status = 'local_pending',
        last_error_code = null
    where id = link_row.id;
  end if;

  -- Close conflict row
  update public.notion_sync_conflicts
  set status = 'resolved',
      resolution = p_resolution,
      resolved_fingerprint = p_new_fp,
      resolved_by = 'user',
      resolved_at = now()
  where id = conflict_row.id;

  return jsonb_build_object('ok', true, 'resolution', p_resolution);
end;
$$;

-- Retire Link atomically
create or replace function public.notion_retire_link(p_link_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.notion_page_links
  set status = 'retired',
      retired_at = now()
  where id = p_link_id and user_id = actor_id and retired_at is null;

  if not found then
    raise exception 'Active link not found';
  end if;

  -- Close any open conflicts
  update public.notion_sync_conflicts
  set status = 'resolved',
      resolution = 'keep_redline',
      resolved_by = 'unlink',
      resolved_at = now()
  where link_id = p_link_id and user_id = actor_id and status = 'open';

  return jsonb_build_object('ok', true, 'link_id', p_link_id);
end;
$$;

-- Grants
grant execute on function public.notion_apply_remote_import to authenticated;
grant execute on function public.notion_resolve_conflict to authenticated;
grant execute on function public.notion_retire_link to authenticated;
