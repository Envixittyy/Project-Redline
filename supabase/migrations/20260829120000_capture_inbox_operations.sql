-- P2 Universal Capture / Inbox: immutable raw evidence, explicit proposals,
-- reversible operation batches, and an atomic text-capture-to-task slice.
-- All functions are security invoker and all rows remain owner-scoped by RLS.

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'text',
  raw_content jsonb not null,
  stage text not null default 'captured',
  interpretation_id uuid,
  operation_batch_id uuid,
  error_code text,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint captures_kind check (
    kind in ('text','pasted_text','image','screenshot','photo','file','link')
  ),
  constraint captures_stage check (
    stage in ('captured','interpreted','proposed','confirmed','committed','undone','failed')
  ),
  constraint captures_raw_object check (jsonb_typeof(raw_content) = 'object'),
  constraint captures_text_content check (
    kind not in ('text','pasted_text')
    or (
      jsonb_typeof(raw_content -> 'text') = 'string'
      and btrim(raw_content ->> 'text') <> ''
      and char_length(raw_content ->> 'text') <= 10000
    )
  )
);

create table public.capture_interpretations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid not null references public.captures (id) on delete cascade,
  source text not null,
  created_at timestamptz not null default now(),
  constraint capture_interpretations_source check (source in ('deterministic','ai','manual'))
);

create table public.capture_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid not null references public.captures (id) on delete cascade,
  interpretation_id uuid not null references public.capture_interpretations (id) on delete cascade,
  action_type text not null,
  payload jsonb not null,
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  committed_at timestamptz,
  constraint capture_proposals_action check (action_type in ('create_task')),
  constraint capture_proposals_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint capture_proposals_status check (
    status in ('proposed','confirmed','committed','rejected')
  )
);

create table public.operation_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid references public.captures (id) on delete set null,
  source text not null,
  status text not null default 'proposed',
  summary text not null,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  undone_at timestamptz,
  undo_expires_at timestamptz,
  constraint operation_batches_source check (
    source in ('user','capture','ai','automation','integration')
  ),
  constraint operation_batches_status check (
    status in ('proposed','confirmed','committed','undone','failed')
  ),
  constraint operation_batches_summary_not_blank check (btrim(summary) <> '')
);

create table public.operation_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  batch_id uuid not null references public.operation_batches (id) on delete cascade,
  position integer not null,
  action_type text not null,
  target_entity text,
  target_id uuid,
  input jsonb not null default '{}'::jsonb,
  inverse jsonb,
  created_at timestamptz not null default now(),
  constraint operation_steps_position check (position >= 0),
  constraint operation_steps_target check (
    target_entity is null
    or target_entity in ('task','event','note','notion_page','work_session')
  ),
  constraint operation_steps_input_object check (jsonb_typeof(input) = 'object'),
  constraint operation_steps_inverse_object check (
    inverse is null or jsonb_typeof(inverse) = 'object'
  ),
  constraint operation_steps_batch_position_unique unique (batch_id, position)
);

alter table public.captures
  add constraint captures_interpretation_fk
    foreign key (interpretation_id) references public.capture_interpretations (id) on delete set null,
  add constraint captures_operation_batch_fk
    foreign key (operation_batch_id) references public.operation_batches (id) on delete set null;

create index captures_owner_inbox_idx
  on public.captures (user_id, captured_at desc);
create index capture_interpretations_capture_idx
  on public.capture_interpretations (user_id, capture_id, created_at desc);
create index capture_proposals_capture_idx
  on public.capture_proposals (user_id, capture_id, created_at desc);
create unique index operation_batches_capture_committed_unique
  on public.operation_batches (capture_id)
  where capture_id is not null and status in ('committed','undone');
create index operation_steps_batch_idx
  on public.operation_steps (user_id, batch_id, position);

create function public.enforce_capture_raw_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.kind is distinct from old.kind
    or new.raw_content is distinct from old.raw_content
    or new.captured_at is distinct from old.captured_at
  then
    raise exception 'raw capture evidence is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.enforce_capture_stage_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage and not (
    (old.stage = 'captured' and new.stage in ('interpreted','failed'))
    or (old.stage = 'interpreted' and new.stage in ('proposed','failed'))
    or (old.stage = 'proposed' and new.stage in ('confirmed','failed'))
    or (old.stage = 'confirmed' and new.stage in ('committed','failed'))
    or (old.stage = 'committed' and new.stage = 'undone')
    or (old.stage = 'failed' and new.stage = 'interpreted')
  ) then
    raise exception 'invalid capture stage transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.enforce_proposal_status_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'proposed' and new.status in ('confirmed','rejected'))
    or (old.status = 'confirmed' and new.status in ('committed','rejected'))
  ) then
    raise exception 'invalid capture proposal transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.enforce_operation_status_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'proposed' and new.status in ('confirmed','failed'))
    or (old.status = 'confirmed' and new.status in ('committed','failed'))
    or (old.status = 'committed' and new.status = 'undone')
  ) then
    raise exception 'invalid operation status transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.enforce_capture_relationship_owner() returns trigger
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

create trigger captures_raw_immutable before update on public.captures
  for each row execute function public.enforce_capture_raw_immutable();
create trigger captures_stage_transition before update on public.captures
  for each row execute function public.enforce_capture_stage_transition();
create trigger captures_relationship_owner
  before insert or update on public.captures
  for each row execute function public.enforce_capture_relationship_owner();
create trigger capture_proposals_status_transition before update on public.capture_proposals
  for each row execute function public.enforce_proposal_status_transition();
create trigger operation_batches_status_transition before update on public.operation_batches
  for each row execute function public.enforce_operation_status_transition();

create trigger capture_interpretations_relationship_owner
  before insert or update on public.capture_interpretations
  for each row execute function public.enforce_capture_relationship_owner();
create trigger capture_proposals_relationship_owner
  before insert or update on public.capture_proposals
  for each row execute function public.enforce_capture_relationship_owner();
create trigger operation_batches_relationship_owner
  before insert or update on public.operation_batches
  for each row execute function public.enforce_capture_relationship_owner();
create trigger operation_steps_relationship_owner
  before insert or update on public.operation_steps
  for each row execute function public.enforce_capture_relationship_owner();

create trigger captures_set_updated_at before update on public.captures
  for each row execute function public.set_updated_at();

alter table public.captures enable row level security;
alter table public.capture_interpretations enable row level security;
alter table public.capture_proposals enable row level security;
alter table public.operation_batches enable row level security;
alter table public.operation_steps enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'captures',
    'capture_interpretations',
    'capture_proposals',
    'operation_batches',
    'operation_steps'
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

create function public.prepare_capture_task(
  target_capture_id uuid,
  proposed_title text
)
returns table (proposal_id uuid, title text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  capture_row public.captures%rowtype;
  new_interpretation_id uuid := gen_random_uuid();
  new_proposal_id uuid := gen_random_uuid();
  normalized_title text := btrim(proposed_title);
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_title = '' or char_length(normalized_title) > 200 then
    raise exception 'task title must be between 1 and 200 characters' using errcode = '23514';
  end if;

  select * into capture_row
  from public.captures
  where id = target_capture_id and user_id = actor
  for update;

  if not found then
    raise exception 'capture not found' using errcode = 'P0002';
  end if;
  if capture_row.kind not in ('text','pasted_text') then
    raise exception 'this capture kind cannot become a task in P2' using errcode = '23514';
  end if;
  if capture_row.stage not in ('captured','failed') then
    raise exception 'capture is not ready for interpretation' using errcode = '23514';
  end if;

  insert into public.capture_interpretations (id, user_id, capture_id, source)
  values (new_interpretation_id, actor, capture_row.id, 'deterministic');

  update public.captures
  set stage = 'interpreted', interpretation_id = new_interpretation_id, error_code = null
  where id = capture_row.id and user_id = actor;

  insert into public.capture_proposals (
    id,
    user_id,
    capture_id,
    interpretation_id,
    action_type,
    payload,
    status
  ) values (
    new_proposal_id,
    actor,
    capture_row.id,
    new_interpretation_id,
    'create_task',
    jsonb_build_object('title', normalized_title, 'status', 'inbox'),
    'proposed'
  );

  update public.captures
  set stage = 'proposed'
  where id = capture_row.id and user_id = actor;

  return query select new_proposal_id, normalized_title;
end;
$$;

create function public.commit_capture_task(
  target_capture_id uuid,
  target_proposal_id uuid,
  task_title text
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
  new_batch_id uuid := gen_random_uuid();
  new_task_id uuid;
  normalized_title text := btrim(task_title);
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_title = '' or char_length(normalized_title) > 200 then
    raise exception 'task title must be between 1 and 200 characters' using errcode = '23514';
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
      payload = jsonb_build_object('title', normalized_title, 'status', 'inbox'),
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
    'Create task from Inbox capture'
  );

  insert into public.tasks (
    user_id,
    title,
    status,
    priority,
    client_operation_id
  ) values (
    actor,
    normalized_title,
    'inbox',
    'none',
    new_batch_id
  )
  returning id into new_task_id;

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
    jsonb_build_object('title', normalized_title, 'status', 'inbox'),
    jsonb_build_object('action', 'delete_task', 'task_id', new_task_id)
  );

  update public.operation_batches
  set status = 'committed',
      committed_at = now(),
      undo_expires_at = now() + interval '10 minutes'
  where id = new_batch_id and user_id = actor;

  update public.capture_proposals
  set status = 'committed', committed_at = now()
  where id = proposal_row.id and user_id = actor;

  update public.captures
  set stage = 'committed', operation_batch_id = new_batch_id
  where id = capture_row.id and user_id = actor;

  return query select new_task_id, new_batch_id;
end;
$$;

create function public.undo_capture_task(target_capture_id uuid)
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

revoke all on function public.prepare_capture_task(uuid, text) from public;
revoke all on function public.commit_capture_task(uuid, uuid, text) from public;
revoke all on function public.undo_capture_task(uuid) from public;
grant execute on function public.prepare_capture_task(uuid, text) to authenticated;
grant execute on function public.commit_capture_task(uuid, uuid, text) to authenticated;
grant execute on function public.undo_capture_task(uuid) to authenticated;
