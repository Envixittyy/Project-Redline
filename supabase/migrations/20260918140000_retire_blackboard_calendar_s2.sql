-- Phase S3 / Cleanup: Safely retire legacy Blackboard Calendar / ICS / S2 implementation.
-- Transition Blackboard to an email-only architecture.
-- Preserves all ordinary Tasks, courses, school_items, school_email_events, and school_course_mappings.

-- 1. Detach capture proposals from legacy external records to prevent FK restrict errors
update public.capture_proposals
  set external_record_id = null
  where external_record_id in (
    select id from public.external_records where provider = 'blackboard'
  );

-- 2. Explicitly detach task_id from legacy Blackboard external records so the Task
-- (specifically the existing GED102 CO2L3B Linear Programming task) remains untouched
update public.external_records
  set task_id = null
  where provider = 'blackboard';

-- 3. Delete Blackboard calendar audit data: sync_changes and sync_runs in FK-safe order
delete from public.sync_changes
  where sync_run_id in (
    select r.id from public.sync_runs r
    join public.integration_accounts a on a.id = r.account_id
    where a.provider = 'blackboard'
  )
  or external_record_id in (
    select id from public.external_records where provider = 'blackboard'
  );

delete from public.sync_runs
  where account_id in (
    select id from public.integration_accounts where provider = 'blackboard'
  );

-- 4. Delete legacy Blackboard external_records
delete from public.external_records
  where provider = 'blackboard';

-- 5. Delete legacy calendar-only mappings if table exists
delete from public.blackboard_course_mappings
  where account_id in (
    select id from public.integration_accounts where provider = 'blackboard'
  );

-- 6. Delete legacy announcements if any exist for Blackboard
delete from public.announcements
  where account_id in (
    select id from public.integration_accounts where provider = 'blackboard'
  );

-- 7. Delete legacy Blackboard integration account and encrypted calendar credential
delete from public.integration_accounts
  where provider = 'blackboard';

-- 8. Drop S2-specific triggers and functions
drop trigger if exists blackboard_s2_sync_mode_activation on public.integration_accounts;
drop function if exists public.enforce_blackboard_sync_mode_activation();

drop trigger if exists blackboard_s2_sync_runs_owner on public.sync_runs;
drop trigger if exists blackboard_s2_sync_changes_owner on public.sync_changes;
drop function if exists public.enforce_blackboard_s2_audit_owner();

drop function if exists public.reconcile_blackboard_calendar_snapshot(uuid, uuid, uuid, jsonb);

-- Drop Phase 7C calendar mapping RPCs
drop function if exists public.bulk_assign_blackboard_records(uuid[], uuid, boolean);
drop function if exists public.upsert_blackboard_course_mapping(uuid, text, uuid);

-- Drop Phase 7C legacy calendar mapping table
drop table if exists public.blackboard_course_mappings cascade;

-- 9. Drop S2-specific indexes and columns from external_records and sync_changes
drop index if exists public.external_records_owner_school_item_idx;
drop index if exists public.sync_changes_owner_school_item_idx;

alter table public.external_records
  drop column if exists school_item_id,
  drop column if exists calendar_source_key,
  drop column if exists calendar_course_key,
  drop column if exists calendar_source_revision,
  drop column if exists school_applied_hash;

alter table public.sync_changes
  drop constraint if exists sync_changes_details_s2_bounded,
  drop column if exists school_item_id;

-- 10. Restore sync_changes_type check constraint to original Phase 2 values
alter table public.sync_changes drop constraint if exists sync_changes_type;
alter table public.sync_changes add constraint sync_changes_type check(change_type in(
  'created','updated','unchanged','missing','ambiguous','failed'
));

-- 11. Drop S2 columns from integration_accounts and sync_runs
alter table public.integration_accounts
  drop column if exists blackboard_sync_mode;

alter table public.sync_runs
  drop column if exists sync_mode,
  drop column if exists snapshot_complete;

-- 12. Restore enforce_external_record_relationship_owner to remove school_item_id check
create or replace function public.enforce_external_record_relationship_owner() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists (
    select 1 from public.integration_accounts account
    where account.id = new.account_id and account.user_id = new.user_id and account.provider = new.provider
  ) then
    raise exception 'account must belong to the external record owner/provider' using errcode = '23503';
  end if;
  if new.course_id is not null and not exists (
    select 1 from public.courses course where course.id = new.course_id and course.user_id = new.user_id
  ) then
    raise exception 'course must belong to the external record owner' using errcode = '23503';
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks task where task.id = new.task_id and task.user_id = new.user_id
  ) then
    raise exception 'task must belong to the external record owner' using errcode = '23503';
  end if;
  return new;
end;
$$;
