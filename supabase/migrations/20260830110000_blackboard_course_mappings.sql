-- Phase 7C: Blackboard Manual Course Mapping & Deterministic Task Pipeline
-- Implements contracts from docs/FORWARD_ARCHITECTURE.md Section 12.1 and 12.2.
-- All tables and functions are owner-scoped by Supabase RLS and security-invoker checks.

-- 1. Create blackboard_course_mappings table
create table if not exists public.blackboard_course_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.integration_accounts(id) on delete cascade,
  source_course_name text not null check (btrim(source_course_name) <> ''),
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Constraints & Indexes
create unique index if not exists blackboard_course_mappings_owner_account_source_idx
  on public.blackboard_course_mappings (user_id, account_id, source_course_name);

create index if not exists blackboard_course_mappings_owner_course_idx
  on public.blackboard_course_mappings (user_id, course_id);

create trigger blackboard_course_mappings_set_updated_at
  before update on public.blackboard_course_mappings
  for each row execute function public.set_updated_at();

-- 3. Owner-relationship verification trigger
create or replace function public.enforce_blackboard_course_mapping_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.integration_accounts acc
    where acc.id = new.account_id and acc.user_id = new.user_id and acc.provider = 'blackboard'
  ) then
    raise exception 'account must belong to the mapping owner and be a blackboard integration' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = new.course_id and c.user_id = new.user_id
  ) then
    raise exception 'course must belong to the mapping owner' using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger blackboard_course_mappings_owner_enforcement
  before insert or update on public.blackboard_course_mappings
  for each row execute function public.enforce_blackboard_course_mapping_owner();

-- 4. Enable Row Level Security (RLS)
alter table public.blackboard_course_mappings enable row level security;

create policy blackboard_course_mappings_select
  on public.blackboard_course_mappings
  for select
  to authenticated
  using (((select auth.uid()) = user_id));

create policy blackboard_course_mappings_insert
  on public.blackboard_course_mappings
  for insert
  to authenticated
  with check (((select auth.uid()) = user_id));

create policy blackboard_course_mappings_update
  on public.blackboard_course_mappings
  for update
  to authenticated
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy blackboard_course_mappings_delete
  on public.blackboard_course_mappings
  for delete
  to authenticated
  using (((select auth.uid()) = user_id));

-- 5. RPC: Upsert Course Mapping
create or replace function public.upsert_blackboard_course_mapping(
  target_account_id uuid,
  target_source_course_name text,
  target_course_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_source text := btrim(target_source_course_name);
  mapping_id uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_source = '' then
    raise exception 'source course name cannot be blank' using errcode = '23514';
  end if;

  insert into public.blackboard_course_mappings (
    user_id,
    account_id,
    source_course_name,
    course_id
  ) values (
    actor,
    target_account_id,
    normalized_source,
    target_course_id
  )
  on conflict (user_id, account_id, source_course_name)
  do update set
    course_id = excluded.course_id,
    updated_at = now()
  returning id into mapping_id;

  return mapping_id;
end;
$$;

-- 6. RPC: Bulk Assign Blackboard Records
create or replace function public.bulk_assign_blackboard_records(
  target_record_ids uuid[],
  target_course_id uuid,
  remember_mapping boolean default true
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  rec record;
  assigned_count integer := 0;
  target_account_id uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.courses where id = target_course_id and user_id = actor
  ) then
    raise exception 'target course not found' using errcode = 'P0002';
  end if;

  -- Process each record
  for rec in
    select id, account_id, course_code, task_id
    from public.external_records
    where id = any(target_record_ids)
      and user_id = actor
      and provider = 'blackboard'
  loop
    target_account_id := rec.account_id;

    -- Update external record course_id
    update public.external_records
    set course_id = target_course_id
    where id = rec.id and user_id = actor;

    -- Update linked proposal payload if uncommitted
    update public.capture_proposals
    set payload = jsonb_set(payload, '{courseId}', to_jsonb(target_course_id::text)),
        updated_at = now()
    where external_record_id = rec.id
      and user_id = actor
      and status = 'proposed';

    -- Update linked native task if already committed
    if rec.task_id is not null then
      update public.tasks
      set course_id = target_course_id,
          updated_at = now()
      where id = rec.task_id and user_id = actor;
    end if;

    -- If remember_mapping is true and course_code is non-empty, upsert mapping and retroactively update matching unassigned records
    if remember_mapping and rec.course_code is not null and btrim(rec.course_code) <> '' then
      insert into public.blackboard_course_mappings (
        user_id,
        account_id,
        source_course_name,
        course_id
      ) values (
        actor,
        rec.account_id,
        btrim(rec.course_code),
        target_course_id
      )
      on conflict (user_id, account_id, source_course_name)
      do update set
        course_id = excluded.course_id,
        updated_at = now();

      -- Retroactively assign other unassigned records from same source course
      update public.external_records
      set course_id = target_course_id
      where user_id = actor
        and account_id = rec.account_id
        and provider = 'blackboard'
        and course_code = rec.course_code
        and course_id is null;

      -- Also update uncommitted capture proposals for those retroactively assigned records
      update public.capture_proposals cp
      set payload = jsonb_set(cp.payload, '{courseId}', to_jsonb(target_course_id::text)),
          updated_at = now()
      from public.external_records er
      where cp.external_record_id = er.id
        and cp.user_id = actor
        and cp.status = 'proposed'
        and er.user_id = actor
        and er.account_id = rec.account_id
        and er.provider = 'blackboard'
        and er.course_code = rec.course_code
        and er.course_id = target_course_id;
    end if;

    assigned_count := assigned_count + 1;
  end loop;

  return assigned_count;
end;
$$;

-- 7. Revoke/Grant permissions
revoke all on public.blackboard_course_mappings from public;
revoke all on function public.upsert_blackboard_course_mapping(uuid, text, uuid) from public;
revoke all on function public.bulk_assign_blackboard_records(uuid[], uuid, boolean) from public;

grant select, insert, update, delete on public.blackboard_course_mappings to authenticated;
grant execute on function public.upsert_blackboard_course_mapping(uuid, text, uuid) to authenticated;
grant execute on function public.bulk_assign_blackboard_records(uuid[], uuid, boolean) to authenticated;
