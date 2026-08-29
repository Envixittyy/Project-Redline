-- P3 external-calendar platform. Provider mirrors remain source-aware and
-- distinct from Forward native events and task work sessions.

create table public.external_calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null,
  display_name text not null,
  status text not null default 'pending',
  access text not null default 'read_only',
  capabilities text[] not null default '{}',
  encrypted_credential text,
  credential_hint text,
  token_expires_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_calendar_accounts_provider check (
    provider in ('google','microsoft','icloud','caldav','ics')
  ),
  constraint external_calendar_accounts_name_not_blank check (btrim(display_name) <> ''),
  constraint external_calendar_accounts_status check (
    status in ('pending','connected','error','disconnected')
  ),
  constraint external_calendar_accounts_access check (access in ('read_only','read_write')),
  constraint external_calendar_accounts_capabilities check (
    capabilities <@ array[
      'list_calendars','list_events','create_event','update_event','delete_event',
      'incremental_sync','watch_changes'
    ]::text[]
  ),
  constraint external_calendar_accounts_connected_credential check (
    status <> 'connected' or encrypted_credential is not null
  ),
  constraint external_calendar_accounts_owner_provider unique (user_id, provider)
);

create table public.external_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.external_calendar_accounts (id) on delete cascade,
  external_calendar_id text not null,
  name text not null,
  access text not null default 'read_only',
  selected boolean not null default true,
  encrypted_sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_calendars_external_id_not_blank check (btrim(external_calendar_id) <> ''),
  constraint external_calendars_name_not_blank check (btrim(name) <> ''),
  constraint external_calendars_access check (access in ('read_only','read_write')),
  constraint external_calendars_account_identity unique (account_id, external_calendar_id)
);

create table public.external_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  calendar_id uuid not null references public.external_calendars (id) on delete cascade,
  external_event_id text not null,
  revision text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  status text not null default 'confirmed',
  source_url text,
  content_hash text not null,
  missing_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_calendar_events_external_id_not_blank check (btrim(external_event_id) <> ''),
  constraint external_calendar_events_revision_not_blank check (btrim(revision) <> ''),
  constraint external_calendar_events_title_not_blank check (btrim(title) <> ''),
  constraint external_calendar_events_interval check (ends_at > starts_at),
  constraint external_calendar_events_status check (
    status in ('confirmed','tentative','cancelled')
  ),
  constraint external_calendar_events_calendar_identity unique (calendar_id, external_event_id)
);

create index external_calendar_accounts_owner_idx
  on public.external_calendar_accounts (user_id, provider);
create index external_calendars_owner_selected_idx
  on public.external_calendars (user_id, selected, account_id);
create index external_calendar_events_owner_range_idx
  on public.external_calendar_events (user_id, starts_at, ends_at)
  where status <> 'cancelled' and missing_since is null;

create function public.enforce_external_calendar_relationship_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'external_calendars' then
    if not exists (
      select 1 from public.external_calendar_accounts account
      where account.id = new.account_id and account.user_id = new.user_id
    ) then
      raise exception 'external calendar account must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'external_calendar_events' then
    if not exists (
      select 1 from public.external_calendars calendar
      where calendar.id = new.calendar_id and calendar.user_id = new.user_id
    ) then
      raise exception 'external event calendar must belong to the same owner' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger external_calendars_relationship_owner
  before insert or update on public.external_calendars
  for each row execute function public.enforce_external_calendar_relationship_owner();
create trigger external_calendar_events_relationship_owner
  before insert or update on public.external_calendar_events
  for each row execute function public.enforce_external_calendar_relationship_owner();

create trigger external_calendar_accounts_set_updated_at
  before update on public.external_calendar_accounts
  for each row execute function public.set_updated_at();
create trigger external_calendars_set_updated_at
  before update on public.external_calendars
  for each row execute function public.set_updated_at();
create trigger external_calendar_events_set_updated_at
  before update on public.external_calendar_events
  for each row execute function public.set_updated_at();

alter table public.external_calendar_accounts enable row level security;
alter table public.external_calendars enable row level security;
alter table public.external_calendar_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'external_calendar_accounts',
    'external_calendars',
    'external_calendar_events'
  ] loop
    execute format(
      'create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name,
      table_name
    );
    execute format(
      'create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name,
      table_name
    );
    execute format(
      'create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name,
      table_name
    );
    execute format(
      'create policy %I_delete_own on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name,
      table_name
    );
  end loop;
end $$;
