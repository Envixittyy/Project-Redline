-- Phase 1G-B: owner-scoped personal data and authenticated RLS.
--
-- Existing rows deliberately receive NULL initially. Run the documented
-- service-role backfill with the intended auth.users ID, verify the counts,
-- and only then call finalize_personal_data_ownership(). The finalizer refuses
-- to add NOT NULL while any ownerless rows remain.

alter table public.tasks
  add column user_id uuid
  references auth.users (id) on delete cascade;

alter table public.calendar_events
  add column user_id uuid
  references auth.users (id) on delete cascade;

-- Set the authenticated default only after the columns exist so migration
-- execution context can never assign an operator identity to historical rows.
alter table public.tasks alter column user_id set default auth.uid();
alter table public.calendar_events alter column user_id set default auth.uid();

create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_user_id_status_due_date_idx
  on public.tasks (user_id, status, due_date);

create index calendar_events_user_id_idx on public.calendar_events (user_id);
create index calendar_events_user_id_range_idx
  on public.calendar_events (user_id, starts_at, ends_at);

-- External identities belong to an owner; two users may sync the same source
-- identity without colliding with each other.
drop index public.calendar_events_external_identity_idx;
create unique index calendar_events_owner_external_identity_idx
  on public.calendar_events (user_id, source, external_id)
  where external_id is not null;

alter table public.tasks enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;

create policy tasks_select_own on public.tasks
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy tasks_insert_own on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy tasks_update_own on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy tasks_delete_own on public.tasks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists calendar_events_select_own on public.calendar_events;
drop policy if exists calendar_events_insert_own on public.calendar_events;
drop policy if exists calendar_events_update_own on public.calendar_events;
drop policy if exists calendar_events_delete_own on public.calendar_events;

create policy calendar_events_select_own on public.calendar_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy calendar_events_insert_own on public.calendar_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy calendar_events_update_own on public.calendar_events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy calendar_events_delete_own on public.calendar_events
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Service-role-only, repeat-safe administrative backfill. Both table updates
-- run in one RPC transaction, so a failure cannot leave a half-applied result.
create or replace function public.backfill_personal_data_owner(target_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tasks_updated bigint;
  events_updated bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if target_owner is null or not exists (
    select 1 from auth.users where id = target_owner
  ) then
    raise exception 'target owner is not an auth user' using errcode = '22023';
  end if;

  update public.tasks set user_id = target_owner where user_id is null;
  get diagnostics tasks_updated = row_count;

  update public.calendar_events set user_id = target_owner where user_id is null;
  get diagnostics events_updated = row_count;

  return jsonb_build_object(
    'tasks_updated', tasks_updated,
    'calendar_events_updated', events_updated
  );
end;
$$;

revoke all on function public.backfill_personal_data_owner(uuid) from public, anon, authenticated;
grant execute on function public.backfill_personal_data_owner(uuid) to service_role;

-- A separate explicit step makes the precondition observable before the
-- irreversible constraint is added. Repeating it is safe.
create or replace function public.finalize_personal_data_ownership()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ownerless_tasks bigint;
  ownerless_events bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select count(*) into ownerless_tasks from public.tasks where user_id is null;
  select count(*) into ownerless_events from public.calendar_events where user_id is null;

  if ownerless_tasks <> 0 or ownerless_events <> 0 then
    raise exception 'ownerless rows remain (tasks: %, calendar_events: %)',
      ownerless_tasks, ownerless_events using errcode = '23502';
  end if;

  alter table public.tasks alter column user_id set not null;
  alter table public.calendar_events alter column user_id set not null;

  return jsonb_build_object(
    'ownerless_tasks', ownerless_tasks,
    'ownerless_calendar_events', ownerless_events,
    'finalized', true
  );
end;
$$;

revoke all on function public.finalize_personal_data_ownership() from public, anon, authenticated;
grant execute on function public.finalize_personal_data_ownership() to service_role;
