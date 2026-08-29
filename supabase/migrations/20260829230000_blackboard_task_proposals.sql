-- Phase 7A: Blackboard Assignment / Deadline -> Reviewable Redline Proposal
-- Implements Codex-approved architecture from docs/FORWARD_ARCHITECTURE.md Section 7.
-- All functions are security invoker and owner-scoped by RLS.

-- 1. Tasks: add nullable owner-checked course_id
alter table public.tasks
  add column if not exists course_id uuid references public.courses(id) on delete set null;

create index if not exists tasks_owner_course_idx
  on public.tasks (user_id, course_id)
  where course_id is not null;

-- 2. External records: add normalized metadata, proposal revision, temporal precision, and task link uniqueness
alter table public.external_records
  add column if not exists normalized_description text check (
    normalized_description is null or char_length(normalized_description) <= 10000
  ),
  add column if not exists proposal_revision text,
  add column if not exists due_date date,
  add column if not exists due_precision text not null default 'none' check (
    due_precision in ('none', 'date', 'instant', 'unresolved')
  ),
  add column if not exists course_id uuid references public.courses(id) on delete set null;

create unique index if not exists external_records_owner_task_unique
  on public.external_records (user_id, task_id)
  where task_id is not null;

create index if not exists external_records_owner_proposal_revision_idx
  on public.external_records (user_id, proposal_revision);

-- 3. Capture proposals: link to external_records, source revisions, and snapshot
alter table public.capture_proposals
  add column if not exists external_record_id uuid references public.external_records(id) on delete restrict,
  add column if not exists source_revision text,
  add column if not exists reviewed_source_revision text,
  add column if not exists source_snapshot jsonb check (
    source_snapshot is null or jsonb_typeof(source_snapshot) = 'object'
  ),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists capture_proposals_owner_external_record_action_unique
  on public.capture_proposals (user_id, external_record_id, action_type)
  where external_record_id is not null;

create index if not exists capture_proposals_owner_status_idx
  on public.capture_proposals (user_id, status);

create trigger capture_proposals_set_updated_at
  before update on public.capture_proposals
  for each row execute function public.set_updated_at();

-- 4. Owner relationship enforcement for new foreign keys
create or replace function public.enforce_task_relationship_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.course_id is not null and not exists (
    select 1 from public.courses course
    where course.id = new.course_id and course.user_id = new.user_id
  ) then
    raise exception 'course must belong to the task owner' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_external_record_relationship_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.course_id is not null and not exists (
    select 1 from public.courses course
    where course.id = new.course_id and course.user_id = new.user_id
  ) then
    raise exception 'course must belong to the external record owner' using errcode = '23503';
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks task
    where task.id = new.task_id and task.user_id = new.user_id
  ) then
    raise exception 'task must belong to the external record owner' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger external_records_relationship_owner
  before insert or update on public.external_records
  for each row execute function public.enforce_external_record_relationship_owner();

-- Update capture relationship owner trigger to cover external_record_id
create or replace function public.enforce_capture_relationship_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'captures' then
    if new.interpretation_id is not null and not exists (
      select 1
      from public.capture_interpretations interpretation
      where interpretation.id = new.interpretation_id
        and interpretation.capture_id = new.id
        and interpretation.user_id = new.user_id
    ) then
      raise exception 'capture interpretation must belong to the same owner' using errcode = '23503';
    end if;
    if new.operation_batch_id is not null and not exists (
      select 1
      from public.operation_batches batch
      where batch.id = new.operation_batch_id
        and batch.capture_id = new.id
        and batch.user_id = new.user_id
    ) then
      raise exception 'capture operation must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'capture_interpretations' then
    if not exists (
      select 1 from public.captures capture
      where capture.id = new.capture_id and capture.user_id = new.user_id
    ) then
      raise exception 'capture must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'capture_proposals' then
    if not exists (
      select 1
      from public.capture_interpretations interpretation
      where interpretation.id = new.interpretation_id
        and interpretation.capture_id = new.capture_id
        and interpretation.user_id = new.user_id
    ) then
      raise exception 'proposal interpretation must belong to the capture owner' using errcode = '23503';
    end if;
    if new.external_record_id is not null and not exists (
      select 1 from public.external_records ext
      where ext.id = new.external_record_id and ext.user_id = new.user_id
    ) then
      raise exception 'external record must belong to the proposal owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'operation_batches' then
    if new.capture_id is not null and not exists (
      select 1 from public.captures capture
      where capture.id = new.capture_id and capture.user_id = new.user_id
    ) then
      raise exception 'operation capture must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'operation_steps' then
    if not exists (
      select 1 from public.operation_batches batch
      where batch.id = new.batch_id and batch.user_id = new.user_id
    ) then
      raise exception 'operation batch must belong to the same owner' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

-- Allow rejected -> proposed on material source revision change
create or replace function public.enforce_proposal_status_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'proposed' and new.status in ('confirmed','rejected'))
    or (old.status = 'confirmed' and new.status in ('committed','rejected'))
    or (old.status = 'rejected' and new.status = 'proposed')
  ) then
    raise exception 'invalid capture proposal transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 5. RPC: Reconcile Blackboard Proposal
create or replace function public.reconcile_blackboard_proposal(
  target_external_record_id uuid,
  proposed_title text,
  proposed_description text default null,
  proposed_due_date text default null,
  proposed_due_at timestamptz default null,
  proposed_due_precision text default 'none',
  proposed_course_id uuid default null,
  next_proposal_revision text default null,
  snapshot jsonb default '{}'::jsonb
)
returns table (proposal_id uuid, proposal_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  ext_record public.external_records%rowtype;
  existing_proposal public.capture_proposals%rowtype;
  new_capture_id uuid := gen_random_uuid();
  new_interpretation_id uuid := gen_random_uuid();
  new_proposal_id uuid := gen_random_uuid();
  normalized_title text := btrim(proposed_title);
  new_payload jsonb;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_title = '' or char_length(normalized_title) > 200 then
    raise exception 'task title must be between 1 and 200 characters' using errcode = '23514';
  end if;

  select * into ext_record
  from public.external_records
  where id = target_external_record_id and user_id = actor
  for update;

  if not found then
    raise exception 'external record not found' using errcode = 'P0002';
  end if;

  new_payload := jsonb_build_object(
    'title', normalized_title,
    'description', proposed_description,
    'dueDate', proposed_due_date,
    'dueAt', proposed_due_at,
    'duePrecision', proposed_due_precision,
    'courseId', proposed_course_id,
    'status', 'inbox'
  );

  select * into existing_proposal
  from public.capture_proposals
  where external_record_id = ext_record.id
    and user_id = actor
    and action_type = 'create_task'
  for update;

  if not found then
    -- First time materializing this external record as a proposal
    insert into public.captures (
      id,
      user_id,
      kind,
      raw_content,
      stage
    ) values (
      new_capture_id,
      actor,
      'text',
      jsonb_build_object('text', normalized_title),
      'proposed'
    );

    insert into public.capture_interpretations (
      id,
      user_id,
      capture_id,
      source
    ) values (
      new_interpretation_id,
      actor,
      new_capture_id,
      'deterministic'
    );

    update public.captures
    set interpretation_id = new_interpretation_id
    where id = new_capture_id and user_id = actor;

    insert into public.capture_proposals (
      id,
      user_id,
      capture_id,
      interpretation_id,
      external_record_id,
      action_type,
      payload,
      source_revision,
      reviewed_source_revision,
      source_snapshot,
      status
    ) values (
      new_proposal_id,
      actor,
      new_capture_id,
      new_interpretation_id,
      ext_record.id,
      'create_task',
      new_payload,
      next_proposal_revision,
      null,
      snapshot,
      'proposed'
    );

    return query select new_proposal_id, 'proposed'::text;
    return;
  end if;

  -- Existing proposal exists
  if existing_proposal.status = 'proposed' then
    -- Unreviewed: refresh in place if source revision changed
    if existing_proposal.source_revision is distinct from next_proposal_revision then
      update public.capture_proposals
      set payload = new_payload,
          source_revision = next_proposal_revision,
          source_snapshot = snapshot,
          updated_at = now()
      where id = existing_proposal.id and user_id = actor;
    end if;
    return query select existing_proposal.id, 'proposed'::text;
    return;
  elsif existing_proposal.status = 'rejected' then
    -- Dismissed: reopen as proposed only if material revision changed
    if existing_proposal.reviewed_source_revision is distinct from next_proposal_revision then
      update public.capture_proposals
      set status = 'proposed',
          payload = new_payload,
          source_revision = next_proposal_revision,
          source_snapshot = snapshot,
          updated_at = now()
      where id = existing_proposal.id and user_id = actor;

      update public.captures
      set stage = 'proposed'
      where id = existing_proposal.capture_id and user_id = actor;

      return query select existing_proposal.id, 'proposed'::text;
      return;
    end if;
    return query select existing_proposal.id, 'rejected'::text;
    return;
  elsif existing_proposal.status = 'committed' then
    -- Accepted into native task: advance source_revision (divergence), never overwrite task
    if existing_proposal.source_revision is distinct from next_proposal_revision then
      update public.capture_proposals
      set source_revision = next_proposal_revision,
          source_snapshot = snapshot,
          updated_at = now()
      where id = existing_proposal.id and user_id = actor;
    end if;
    return query select existing_proposal.id, 'committed'::text;
    return;
  else
    return query select existing_proposal.id, existing_proposal.status;
    return;
  end if;
end;
$$;

-- 6. RPC: Dismiss capture proposal
create or replace function public.dismiss_capture_proposal(target_proposal_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  proposal_row public.capture_proposals%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into proposal_row
  from public.capture_proposals
  where id = target_proposal_id and user_id = actor
  for update;

  if not found then
    raise exception 'capture proposal not found' using errcode = 'P0002';
  end if;

  if proposal_row.status = 'proposed' then
    update public.capture_proposals
    set status = 'rejected',
        reviewed_source_revision = source_revision,
        updated_at = now()
    where id = proposal_row.id and user_id = actor;

    return true;
  end if;

  return false;
end;
$$;

-- 7. RPC: Acknowledge proposal divergence (for committed proposals)
create or replace function public.acknowledge_proposal_divergence(target_proposal_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  proposal_row public.capture_proposals%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into proposal_row
  from public.capture_proposals
  where id = target_proposal_id and user_id = actor
  for update;

  if not found then
    raise exception 'capture proposal not found' using errcode = 'P0002';
  end if;

  if proposal_row.status = 'committed' then
    update public.capture_proposals
    set reviewed_source_revision = source_revision,
        updated_at = now()
    where id = proposal_row.id and user_id = actor;

    return true;
  end if;

  return false;
end;
$$;

-- 8. Extend commit_capture_task with full metadata and external-record linking
create or replace function public.commit_capture_task(
  target_capture_id uuid,
  target_proposal_id uuid,
  task_title text,
  task_description text default null,
  task_due_date text default null,
  task_due_at timestamptz default null,
  task_course_id uuid default null
)
returns table (created_task_id uuid, committed_batch_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  capture_row public.captures%rowtype;
  proposal_row public.capture_proposals%rowtype;
  ext_record public.external_records%rowtype;
  new_batch_id uuid := gen_random_uuid();
  new_task_id uuid;
  normalized_title text := btrim(task_title);
  parsed_due_date date := null;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_title = '' or char_length(normalized_title) > 200 then
    raise exception 'task title must be between 1 and 200 characters' using errcode = '23514';
  end if;

  if task_due_date is not null and task_due_date <> '' then
    begin
      parsed_due_date := task_due_date::date;
    exception when others then
      raise exception 'invalid due date format' using errcode = '23514';
    end;
  end if;

  select * into capture_row
  from public.captures
  where id = target_capture_id and user_id = actor
  for update;
  if not found then
    raise exception 'capture not found' using errcode = 'P0002';
  end if;

  select * into proposal_row
  from public.capture_proposals
  where id = target_proposal_id
    and capture_id = capture_row.id
    and user_id = actor
    and action_type = 'create_task'
  for update;
  if not found then
    raise exception 'capture proposal not found' using errcode = 'P0002';
  end if;

  -- Lock and validate external record if linked
  if proposal_row.external_record_id is not null then
    select * into ext_record
    from public.external_records
    where id = proposal_row.external_record_id and user_id = actor
    for update;

    if not found then
      raise exception 'linked external record not found' using errcode = 'P0002';
    end if;

    if ext_record.missing_since is not null then
      raise exception 'external item is missing and cannot be confirmed' using errcode = '23514';
    end if;

    if proposal_row.source_revision is distinct from ext_record.proposal_revision then
      raise exception 'external item changed and must be refreshed before confirmation' using errcode = '23514';
    end if;
  end if;

  -- Idempotent return if already committed
  if capture_row.stage = 'committed' and proposal_row.status = 'committed' then
    return query
      select step.target_id, batch.id
      from public.operation_batches batch
      join public.operation_steps step on step.batch_id = batch.id
      where batch.id = capture_row.operation_batch_id
        and batch.user_id = actor
        and step.user_id = actor
        and step.action_type = 'create_task'
      order by step.position
      limit 1;
    return;
  end if;

  if capture_row.stage <> 'proposed' or proposal_row.status <> 'proposed' then
    raise exception 'capture proposal is not ready to commit' using errcode = '23514';
  end if;

  update public.capture_proposals
  set status = 'confirmed',
      payload = jsonb_build_object(
        'title', normalized_title,
        'description', task_description,
        'dueDate', task_due_date,
        'dueAt', task_due_at,
        'courseId', task_course_id,
        'status', 'inbox'
      ),
      confirmed_at = now()
  where id = proposal_row.id and user_id = actor;

  update public.captures
  set stage = 'confirmed'
  where id = capture_row.id and user_id = actor;

  insert into public.operation_batches (
    id,
    user_id,
    capture_id,
    source,
    status,
    summary
  ) values (
    new_batch_id,
    actor,
    capture_row.id,
    'capture',
    'confirmed',
    case
      when proposal_row.external_record_id is not null then 'Create task from Blackboard calendar proposal'
      else 'Create task from Inbox capture'
    end
  );

  insert into public.tasks (
    user_id,
    title,
    description,
    due_date,
    due_at,
    course_id,
    status,
    priority,
    client_operation_id
  ) values (
    actor,
    normalized_title,
    task_description,
    parsed_due_date,
    task_due_at,
    task_course_id,
    'inbox',
    'none',
    new_batch_id
  )
  returning id into new_task_id;

  -- Link external record to native task
  if proposal_row.external_record_id is not null then
    update public.external_records
    set task_id = new_task_id
    where id = proposal_row.external_record_id
      and user_id = actor
      and task_id is null;
  end if;

  insert into public.operation_steps (
    user_id,
    batch_id,
    position,
    action_type,
    target_entity,
    target_id,
    input,
    inverse
  ) values (
    actor,
    new_batch_id,
    0,
    'create_task',
    'task',
    new_task_id,
    jsonb_build_object(
      'title', normalized_title,
      'description', task_description,
      'dueDate', task_due_date,
      'dueAt', task_due_at,
      'courseId', task_course_id,
      'status', 'inbox'
    ),
    jsonb_build_object('action', 'delete_task', 'task_id', new_task_id)
  );

  update public.operation_batches
  set status = 'committed',
      committed_at = now(),
      undo_expires_at = now() + interval '10 minutes'
  where id = new_batch_id and user_id = actor;

  update public.capture_proposals
  set status = 'committed',
      reviewed_source_revision = source_revision,
      committed_at = now()
  where id = proposal_row.id and user_id = actor;

  update public.captures
  set stage = 'committed', operation_batch_id = new_batch_id
  where id = capture_row.id and user_id = actor;

  return query select new_task_id, new_batch_id;
end;
$$;

-- 9. Extend undo_capture_task to clear external_records.task_id link
create or replace function public.undo_capture_task(target_capture_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  capture_row public.captures%rowtype;
  batch_row public.operation_batches%rowtype;
  target_task_id uuid;
  target_task_updated_at timestamptz;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into capture_row
  from public.captures
  where id = target_capture_id and user_id = actor
  for update;
  if not found then
    raise exception 'capture not found' using errcode = 'P0002';
  end if;
  if capture_row.stage = 'undone' then
    return true;
  end if;
  if capture_row.stage <> 'committed' or capture_row.operation_batch_id is null then
    raise exception 'capture does not have a committed operation' using errcode = '23514';
  end if;

  select * into batch_row
  from public.operation_batches
  where id = capture_row.operation_batch_id
    and capture_id = capture_row.id
    and user_id = actor
    and source = 'capture'
  for update;
  if not found or batch_row.status <> 'committed' then
    raise exception 'capture operation is not available for undo' using errcode = '23514';
  end if;
  if batch_row.undo_expires_at is null or batch_row.undo_expires_at < now() then
    raise exception 'the undo window has expired' using errcode = '23514';
  end if;

  select target_id into target_task_id
  from public.operation_steps
  where batch_id = batch_row.id
    and user_id = actor
    and action_type = 'create_task'
    and target_entity = 'task'
  order by position
  limit 1;
  if target_task_id is null then
    raise exception 'capture operation has no reversible task step' using errcode = '23514';
  end if;

  select updated_at into target_task_updated_at
  from public.tasks
  where id = target_task_id and user_id = actor;

  if found then
    if target_task_updated_at > batch_row.committed_at
      or exists (
        select 1 from public.tasks child
        where child.parent_task_id = target_task_id and child.user_id = actor
      )
    then
      raise exception 'the created task changed and can no longer be safely undone' using errcode = '23514';
    end if;

    -- Unlink external records
    update public.external_records
    set task_id = null
    where task_id = target_task_id and user_id = actor;

    delete from public.tasks
    where id = target_task_id and user_id = actor;
  end if;

  update public.operation_batches
  set status = 'undone', undone_at = now()
  where id = batch_row.id and user_id = actor;

  update public.captures
  set stage = 'undone'
  where id = capture_row.id and user_id = actor;

  return true;
end;
$$;

-- Revoke/grant permissions
revoke all on function public.reconcile_blackboard_proposal(uuid, text, text, text, timestamptz, text, uuid, text, jsonb) from public;
revoke all on function public.dismiss_capture_proposal(uuid) from public;
revoke all on function public.acknowledge_proposal_divergence(uuid) from public;
revoke all on function public.commit_capture_task(uuid, uuid, text, text, text, timestamptz, uuid) from public;
revoke all on function public.undo_capture_task(uuid) from public;

grant execute on function public.reconcile_blackboard_proposal(uuid, text, text, text, timestamptz, text, uuid, text, jsonb) to authenticated;
grant execute on function public.dismiss_capture_proposal(uuid) to authenticated;
grant execute on function public.acknowledge_proposal_divergence(uuid) to authenticated;
grant execute on function public.commit_capture_task(uuid, uuid, text, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.undo_capture_task(uuid) to authenticated;
