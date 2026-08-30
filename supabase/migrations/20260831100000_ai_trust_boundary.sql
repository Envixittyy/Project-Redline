-- Phase 10A: server-authenticated, owner-scoped, narrow AI checklist pipeline.
-- Install AI_TRUST_SIGNING_KEY separately in the server and private key table.
-- No service-role client, credentials in models, or generic action executor.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists ai_private;
revoke all on schema ai_private from public, anon, authenticated;
create table ai_private.signing_key (
  singleton boolean primary key default true check (singleton),
  secret bytea not null check (octet_length(secret) = 32)
);
revoke all on ai_private.signing_key from public, anon, authenticated;

create function ai_private.verify_command(p_message text, p_mac text, p_operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; k bytea; expected bytea;
begin
  if auth.uid() is null or p_message is null or octet_length(p_message) > 49152
    or p_mac is null or p_mac !~ '^[a-f0-9]{64}$' then raise exception 'ai_authorization_denied'; end if;
  select secret into k from ai_private.signing_key where singleton;
  if k is null then raise exception 'ai_trust_not_configured'; end if;
  expected := extensions.hmac(convert_to(p_message, 'UTF8'), k, 'sha256');
  -- Compare keyed hashes of the MACs, so prefix timing reveals no chosen MAC bytes.
  if extensions.hmac(decode(p_mac, 'hex'), k, 'sha256') <> extensions.hmac(expected, k, 'sha256') then
    raise exception 'ai_authorization_denied';
  end if;
  v := p_message::jsonb;
  if (v->>'version') is distinct from '1' or (v->>'user_id') is distinct from auth.uid()::text
    or (v->>'operation') is distinct from p_operation or jsonb_typeof(v->'data') is distinct from 'object'
    or v->>'expires' is null or (v->>'expires')::bigint <= extract(epoch from clock_timestamp())
    or (v->>'expires')::bigint > extract(epoch from clock_timestamp()) + 90 then
    raise exception 'ai_authorization_denied';
  end if;
  return v->'data';
end $$;
revoke all on function ai_private.verify_command(text,text,text) from public, anon, authenticated;

-- Parent locking serializes checklist edits/inserts/deletes with AI commit. Ordinary
-- task metadata does not participate in the semantic revision below.
create function public.lock_task_checklist_parent() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare old_parent uuid; new_parent uuid;
begin
  if tg_op <> 'INSERT' then old_parent := old.parent_task_id; end if;
  if tg_op <> 'DELETE' then new_parent := new.parent_task_id; end if;
  perform id from public.tasks where id in (old_parent, new_parent) order by id for update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger tasks_checklist_parent_lock before insert or update or delete on public.tasks
  for each row execute function public.lock_task_checklist_parent();

create function public.ai_read_task_context(p_task_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare t public.tasks%rowtype; children jsonb; semantic jsonb;
begin
  select * into t from public.tasks where id = p_task_id and user_id = auth.uid();
  if not found then raise exception 'ai_source_unavailable'; end if;
  if t.status::text not in ('inbox','todo','in_progress') then raise exception 'ai_source_unavailable'; end if;
  if char_length(t.title) > 200 or char_length(coalesce(t.description,'')) > 8000
    or (select count(*) from public.tasks where parent_task_id = t.id and user_id = auth.uid()) > 50
    or exists(select 1 from public.tasks where parent_task_id = t.id and user_id = auth.uid() and char_length(title) > 200)
    then raise exception 'ai_context_too_large'; end if;
  select coalesce(jsonb_agg(jsonb_build_array(id, title, status) order by id), '[]'::jsonb)
    into children from public.tasks where parent_task_id = t.id and user_id = auth.uid();
  semantic := jsonb_build_array(1, t.title, t.description, t.status, t.course_id, children);
  return jsonb_build_object('title',t.title,'description',t.description,
    'existingChecklistTitles',coalesce((select jsonb_agg(c->1) from jsonb_array_elements(children) c),'[]'::jsonb),
    'revision',encode(sha256(convert_to(semantic::text,'UTF8')),'hex'));
end $$;
revoke all on function public.ai_read_task_context(uuid) from public, anon;
grant execute on function public.ai_read_task_context(uuid) to authenticated;

create table public.ai_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  task_handle text not null check (task_handle ~ '^task_[a-f0-9]{32}$'),
  source_revision text not null check (source_revision ~ '^[a-f0-9]{64}$'),
  capability text not null check (capability = 'taskChecklist.propose'),
  provider text not null check (provider in ('ollama','llamacpp','openai_compatible')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  status text not null default 'prepared' check (status in ('prepared','proposed','cancelled','conflict','applied','rejected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes')
);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from public, anon, authenticated;
grant select on public.ai_requests to authenticated;
create policy ai_requests_owner_read on public.ai_requests for select to authenticated using (user_id = (select auth.uid()));
create index ai_requests_owner_created on public.ai_requests(user_id, created_at);
alter table public.operation_batches add column ai_request_id uuid unique references public.ai_requests(id) on delete restrict;

-- Restrictive policies also prevent changing a non-AI row into an AI row, or
-- moving a step out of a trusted batch. Existing capture transactions stay intact.
create policy ai_batches_insert_guard on public.operation_batches as restrictive for insert to authenticated
  with check (source <> 'ai' and ai_request_id is null);
create policy ai_batches_update_guard on public.operation_batches as restrictive for update to authenticated
  using (source <> 'ai' and ai_request_id is null) with check (source <> 'ai' and ai_request_id is null);
create policy ai_batches_delete_guard on public.operation_batches as restrictive for delete to authenticated
  using (source <> 'ai' and ai_request_id is null);
create policy ai_steps_insert_guard on public.operation_steps as restrictive for insert to authenticated
  with check (exists(select 1 from public.operation_batches b where b.id = batch_id and b.source <> 'ai' and b.ai_request_id is null));
create policy ai_steps_update_guard on public.operation_steps as restrictive for update to authenticated
  using (exists(select 1 from public.operation_batches b where b.id = batch_id and b.source <> 'ai' and b.ai_request_id is null))
  with check (exists(select 1 from public.operation_batches b where b.id = batch_id and b.source <> 'ai' and b.ai_request_id is null));
create policy ai_steps_delete_guard on public.operation_steps as restrictive for delete to authenticated
  using (exists(select 1 from public.operation_batches b where b.id = batch_id and b.source <> 'ai' and b.ai_request_id is null));

create or replace function public.enforce_operation_status_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'proposed' and new.status in ('confirmed','failed'))
    or (old.status = 'proposed' and new.status = 'rejected' and old.source = 'ai')
    or (old.status = 'confirmed' and new.status in ('committed','failed'))
    or (old.status = 'committed' and new.status = 'undone')
  ) then raise exception 'invalid operation status transition' using errcode = '23514'; end if;
  return new;
end $$;

create function public.ai_create_checklist_request(p_message text, p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; c jsonb; request_id uuid;
begin
  d := ai_private.verify_command(p_message,p_mac,'prepare_checklist');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 10));
  if (select count(*) from public.ai_requests where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'ai_rate_limited'; end if;
  perform id from public.tasks where id = (d->>'task_id')::uuid and user_id = auth.uid() for update;
  c := public.ai_read_task_context((d->>'task_id')::uuid);
  if (d->>'source_revision') is distinct from (c->>'revision') then raise exception 'ai_source_changed'; end if;
  request_id := (d->>'id')::uuid;
  insert into public.ai_requests(id,user_id,task_id,task_handle,source_revision,capability,provider,model)
    values(request_id,auth.uid(),(d->>'task_id')::uuid,d->>'task_handle',d->>'source_revision',d->>'capability',d->>'provider',d->>'model');
  return request_id;
end $$;

create function ai_private.validate_checklist(p jsonb, handle text) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 32768
    or (select count(*) from jsonb_object_keys(p)) <> 4
    or (p->'schema_version') is distinct from '1'::jsonb or (p->>'type') is distinct from 'add_task_checklist'
    or (p->>'task_handle') is distinct from handle or jsonb_typeof(p->'items') is distinct from 'array' then
    raise exception 'ai_invalid_proposal'; end if;
  if jsonb_array_length(p->'items') not between 1 and 20 or exists (
    select 1 from jsonb_array_elements(p->'items') i where jsonb_typeof(i) <> 'string'
      or char_length(btrim(i #>> '{}')) not between 1 and 200 or (i #>> '{}') ~ '[[:cntrl:]]'
  ) or (select count(distinct lower(btrim(i))) from jsonb_array_elements_text(p->'items') i) <> jsonb_array_length(p->'items')
  then raise exception 'ai_invalid_proposal'; end if;
end $$;
revoke all on function ai_private.validate_checklist(jsonb,text) from public, anon, authenticated;

create function public.ai_record_checklist_proposal(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; r public.ai_requests%rowtype; c jsonb; batch_id uuid := gen_random_uuid();
begin
  d := ai_private.verify_command(p_message,p_mac,'record_checklist');
  select * into r from public.ai_requests where id = (d->>'request_id')::uuid and user_id = auth.uid() for update;
  if not found or r.status <> 'prepared' or r.expires_at <= now() then raise exception 'ai_request_unavailable'; end if;
  perform id from public.tasks where id = r.task_id and user_id = auth.uid() for update;
  c := public.ai_read_task_context(r.task_id);
  if (c->>'revision') is distinct from r.source_revision then raise exception 'ai_source_changed'; end if;
  perform ai_private.validate_checklist(d->'proposal', r.task_handle);
  insert into public.operation_batches(id,user_id,source,status,summary,ai_request_id)
    values(batch_id,auth.uid(),'ai','proposed','Checklist additions for selected task',r.id);
  insert into public.operation_steps(user_id,batch_id,position,action_type,target_entity,target_id,input)
    values(auth.uid(),batch_id,0,'add_task_checklist','task',r.task_id,d->'proposal');
  update public.ai_requests set status = 'proposed' where id = r.id;
  return batch_id;
end $$;

-- This is a domain-specific task transaction: it cannot execute arbitrary action
-- names, SQL, other domain writes, or client-supplied operation arrays.
create function public.apply_ai_task_checklist(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; r public.ai_requests%rowtype; b public.operation_batches%rowtype;
  s public.operation_steps%rowtype; c jsonb; item text; new_id uuid; ids jsonb := '[]'::jsonb;
begin
  d := ai_private.verify_command(p_message,p_mac,'approve_checklist');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_requests where id = b.ai_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'taskChecklist.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok',true,'alreadyApplied',true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  if r.expires_at <= now() then raise exception 'ai_request_unavailable'; end if;
  if coalesce((select permission_mode from public.ai_preferences where user_id = auth.uid()), 'ask_before_changing') <> 'ask_before_changing'
    then raise exception 'ai_permission_denied'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and position = 0 and user_id = auth.uid();
  if not found or s.action_type <> 'add_task_checklist' or s.target_id <> r.task_id or s.target_entity <> 'task' then raise exception 'ai_invalid_proposal'; end if;
  perform ai_private.validate_checklist(s.input,r.task_handle);
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text,'UTF8')),'hex') then raise exception 'ai_review_changed'; end if;
  perform id from public.tasks where id = r.task_id and user_id = auth.uid() for update;
  if not found then raise exception 'ai_source_unavailable'; end if;
  c := public.ai_read_task_context(r.task_id);
  if c->>'revision' <> r.source_revision then
    update public.operation_batches set status = 'failed' where id = b.id;
    update public.ai_requests set status = 'conflict' where id = r.id;
    return jsonb_build_object('ok',false,'code','source_changed');
  end if;
  if exists(select 1 from public.tasks t cross join jsonb_array_elements_text(s.input->'items') i
    where t.parent_task_id = r.task_id and t.user_id = auth.uid() and lower(btrim(t.title)) = lower(btrim(i)))
    then raise exception 'ai_duplicate_checklist_item'; end if;
  update public.operation_batches set status = 'confirmed' where id = b.id;
  for item in select jsonb_array_elements_text(s.input->'items') loop
    insert into public.tasks(user_id,title,status,priority,parent_task_id)
      values(auth.uid(),btrim(item),'todo','none',r.task_id) returning id into new_id;
    ids := ids || jsonb_build_array(new_id);
  end loop;
  -- Immutable input remains the reviewed proposal; result IDs are audit metadata.
  update public.operation_steps set inverse = jsonb_build_object('created_task_ids',ids,'undo_supported',false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(ids));
end $$;

create function public.ai_reject_checklist(p_message text,p_mac text) returns void
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype;
begin
  d := ai_private.verify_command(p_message,p_mac,'reject_checklist');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_request_id is null or b.status <> 'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  update public.operation_batches set status = 'rejected' where id = b.id;
  update public.ai_requests set status = 'rejected' where id = b.ai_request_id and user_id = auth.uid();
end $$;

-- Read a persisted proposal and its canonical DB digest, never a browser action list.
create function public.ai_read_checklist_review(p_batch_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('batchId',b.id,'taskTitle',t.title,'items',s.input->'items','status',b.status,
    'proposal',s.input,'proposalDigest',encode(sha256(convert_to(s.input::text,'UTF8')),'hex'),
    'capability',r.capability,'taskHandle',r.task_handle)
  from public.operation_batches b join public.ai_requests r on r.id = b.ai_request_id and r.user_id = auth.uid()
    join public.operation_steps s on s.batch_id = b.id and s.position = 0 and s.user_id = auth.uid()
    join public.tasks t on t.id = r.task_id and t.user_id = auth.uid()
  where b.id = p_batch_id and b.user_id = auth.uid() and b.source = 'ai'
$$;

revoke all on function public.ai_create_checklist_request(text,text) from public,anon;
revoke all on function public.ai_record_checklist_proposal(text,text) from public,anon;
revoke all on function public.apply_ai_task_checklist(text,text) from public,anon;
revoke all on function public.ai_reject_checklist(text,text) from public,anon;
revoke all on function public.ai_read_checklist_review(uuid) from public,anon;
grant execute on function public.ai_create_checklist_request(text,text) to authenticated;
grant execute on function public.ai_record_checklist_proposal(text,text) to authenticated;
grant execute on function public.apply_ai_task_checklist(text,text) to authenticated;
grant execute on function public.ai_reject_checklist(text,text) to authenticated;
grant execute on function public.ai_read_checklist_review(uuid) to authenticated;
