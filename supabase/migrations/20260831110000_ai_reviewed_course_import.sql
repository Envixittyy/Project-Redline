-- Gemini integration: immutable edited reviews and one bounded course import.
-- Reuses the Phase 10A HMAC verifier; does not extend generic AI execution.

alter table public.operation_steps drop constraint operation_steps_target;
alter table public.operation_steps add constraint operation_steps_target check (
  target_entity is null or target_entity in ('task','event','note','notion_page','work_session','course')
);

-- Edits become a new immutable batch; old review IDs are rejected atomically.
alter table public.operation_batches drop constraint operation_batches_ai_request_id_key;
create unique index ai_checklist_one_pending_review on public.operation_batches(ai_request_id) where status = 'proposed' and ai_request_id is not null;
create function public.ai_revise_checklist(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_requests%rowtype; c jsonb; next_id uuid := gen_random_uuid();
begin
  d := ai_private.verify_command(p_message,p_mac,'revise_checklist');
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_request_id is null or b.status <> 'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  select * into r from public.ai_requests where id=b.ai_request_id and user_id=auth.uid() for update;
  if not found or r.capability <> 'taskChecklist.propose' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_request_unavailable'; end if;
  perform id from public.tasks where id=r.task_id and user_id=auth.uid() for update;
  c := public.ai_read_task_context(r.task_id);
  if (c->>'revision') is distinct from r.source_revision then raise exception 'ai_source_changed'; end if;
  perform ai_private.validate_checklist(d->'proposal',r.task_handle);
  update public.operation_batches set status='rejected' where id=b.id;
  insert into public.operation_batches(id,user_id,source,status,summary,ai_request_id)
    values(next_id,auth.uid(),'ai','proposed','Reviewed checklist revision',r.id);
  insert into public.operation_steps(user_id,batch_id,position,action_type,target_entity,target_id,input)
    values(auth.uid(),next_id,0,'add_task_checklist','task',r.task_id,d->'proposal');
  return next_id;
end $$;
revoke all on function public.ai_revise_checklist(text,text) from public,anon;
grant execute on function public.ai_revise_checklist(text,text) to authenticated;

create table public.ai_course_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_handle text not null check (source_handle ~ '^document_[a-f0-9]{32}$'),
  source_text text not null check (char_length(source_text) between 1 and 25000 and octet_length(source_text) <= 32768),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  file_name text not null check (char_length(file_name) between 1 and 200),
  capability text not null check (capability='courseImport.propose'),
  provider text not null check (provider in ('ollama','llamacpp','openai_compatible')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  start_date date not null,
  time_zone text not null,
  status text not null default 'prepared' check (status in ('prepared','proposed','applied','rejected','conflict')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '5 minutes')
);
alter table public.ai_course_requests enable row level security;
revoke all on public.ai_course_requests from public,anon,authenticated;
grant select on public.ai_course_requests to authenticated;
create policy ai_course_requests_owner_read on public.ai_course_requests for select to authenticated using (user_id=(select auth.uid()));
create index ai_course_requests_owner_created on public.ai_course_requests(user_id,created_at);
alter table public.operation_batches add column ai_course_request_id uuid references public.ai_course_requests(id) on delete restrict;
alter table public.operation_batches add constraint ai_request_domain_exclusive check (ai_request_id is null or ai_course_request_id is null);
create unique index ai_course_one_pending_review on public.operation_batches(ai_course_request_id) where status='proposed' and ai_course_request_id is not null;
-- Protect the new relationship even if a browser labels the row non-AI.
alter policy ai_batches_insert_guard on public.operation_batches with check (source <> 'ai' and ai_request_id is null and ai_course_request_id is null);
alter policy ai_batches_update_guard on public.operation_batches using (source <> 'ai' and ai_request_id is null and ai_course_request_id is null) with check (source <> 'ai' and ai_request_id is null and ai_course_request_id is null);
alter policy ai_batches_delete_guard on public.operation_batches using (source <> 'ai' and ai_request_id is null and ai_course_request_id is null);
alter policy ai_steps_insert_guard on public.operation_steps with check (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null));
alter policy ai_steps_update_guard on public.operation_steps using (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null)) with check (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null));
alter policy ai_steps_delete_guard on public.operation_steps using (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null));

create function ai_private.validate_course(p jsonb, handle text) returns void
language plpgsql set search_path = '' as $$
declare c jsonb; m jsonb; k text;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384 or (select count(*) from jsonb_object_keys(p))<>4
    or (p->'schema_version') is distinct from '1'::jsonb or (p->>'type') is distinct from 'create_course'
    or (p->>'source_handle') is distinct from handle or jsonb_typeof(p->'course') is distinct from 'object' then raise exception 'ai_invalid_proposal'; end if;
  c:=p->'course';
  if (select count(*) from jsonb_object_keys(c))<>5 or exists(select 1 from jsonb_object_keys(c) v where v not in ('code','name','instructor','location','meetings'))
    or jsonb_typeof(c->'code') is distinct from 'string' or char_length(btrim(c->>'code')) not between 1 and 20
    or jsonb_typeof(c->'name') is distinct from 'string' or char_length(btrim(c->>'name')) not between 1 and 100
    or jsonb_typeof(c->'meetings') is distinct from 'array' then raise exception 'ai_invalid_proposal'; end if;
  if (c->>'code') ~ '[[:cntrl:]]' or (c->>'name') ~ '[[:cntrl:]]' or jsonb_array_length(c->'meetings')>7 then raise exception 'ai_invalid_proposal'; end if;
  foreach k in array array['instructor','location'] loop
    if (jsonb_typeof(c->k) is distinct from 'string' and jsonb_typeof(c->k) is distinct from 'null')
      or char_length(btrim(c->>k)) not between 1 and 100 or (c->>k) ~ '[[:cntrl:]]' then raise exception 'ai_invalid_proposal'; end if;
  end loop;
  for m in select * from jsonb_array_elements(c->'meetings') loop
    if jsonb_typeof(m) is distinct from 'object' or (select count(*) from jsonb_object_keys(m))<>5
      or exists(select 1 from jsonb_object_keys(m) v where v not in ('title','weekdays','startTime','endTime','location'))
      or jsonb_typeof(m->'title') is distinct from 'string' or char_length(btrim(m->>'title')) not between 1 and 100
      or (m->>'title') ~ '[[:cntrl:]]' or jsonb_typeof(m->'weekdays') is distinct from 'array'
      or jsonb_typeof(m->'startTime') is distinct from 'string' or (m->>'startTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(m->'endTime') is distinct from 'string' or (m->>'endTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (m->>'startTime') >= (m->>'endTime') then raise exception 'ai_invalid_proposal'; end if;
    if jsonb_array_length(m->'weekdays') not between 1 and 7 or exists(select 1 from jsonb_array_elements(m->'weekdays') v where jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[0-6]$')
      or (select count(distinct v) from jsonb_array_elements(m->'weekdays') v)<>jsonb_array_length(m->'weekdays') then raise exception 'ai_invalid_proposal'; end if;
    if (jsonb_typeof(m->'location') is distinct from 'string' and jsonb_typeof(m->'location') is distinct from 'null')
      or char_length(btrim(m->>'location')) not between 1 and 100 or (m->>'location') ~ '[[:cntrl:]]' then raise exception 'ai_invalid_proposal'; end if;
  end loop;
end $$;
revoke all on function ai_private.validate_course(jsonb,text) from public,anon,authenticated;

create function public.ai_create_course_request(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_course');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,11));
  if (select count(*) from public.ai_course_requests where user_id=auth.uid() and created_at>now()-interval '1 minute')>=10 then raise exception 'ai_rate_limited'; end if;
  if (d->>'source_digest') is distinct from encode(sha256(convert_to(d->>'source_text','UTF8')),'hex')
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'time_zone') then raise exception 'ai_invalid_source'; end if;
  insert into public.ai_course_requests(id,user_id,source_handle,source_text,source_digest,file_name,capability,provider,model,start_date,time_zone)
    values((d->>'id')::uuid,auth.uid(),d->>'source_handle',d->>'source_text',d->>'source_digest',d->>'file_name',d->>'capability',d->>'provider',d->>'model',(d->>'start_date')::date,d->>'time_zone');
  return (d->>'id')::uuid;
end $$;

create function public.ai_record_course_proposal(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; r public.ai_course_requests%rowtype; batch_id uuid:=gen_random_uuid();
begin
  d:=ai_private.verify_command(p_message,p_mac,'record_course');
  select * into r from public.ai_course_requests where id=(d->>'request_id')::uuid and user_id=auth.uid() for update;
  if not found or r.status<>'prepared' or r.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
  if r.source_digest<>encode(sha256(convert_to(r.source_text,'UTF8')),'hex') then raise exception 'ai_source_changed'; end if;
  perform ai_private.validate_course(d->'proposal',r.source_handle);
  insert into public.operation_batches(id,user_id,source,status,summary,ai_course_request_id) values(batch_id,auth.uid(),'ai','proposed','Course import from selected text document',r.id);
  insert into public.operation_steps(user_id,batch_id,position,action_type,target_entity,input) values(auth.uid(),batch_id,0,'create_course','course',d->'proposal');
  update public.ai_course_requests set status='proposed' where id=r.id;
  return batch_id;
end $$;

create function public.ai_revise_course_proposal(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_course_requests%rowtype; next_id uuid:=gen_random_uuid();
begin
  d:=ai_private.verify_command(p_message,p_mac,'revise_course');
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid() for update;
  if not found or b.source<>'ai' or b.ai_course_request_id is null or b.status<>'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  select * into r from public.ai_course_requests where id=b.ai_course_request_id and user_id=auth.uid() for update;
  if not found or r.capability<>'courseImport.propose' or r.status<>'proposed' or r.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
  if r.source_digest<>encode(sha256(convert_to(r.source_text,'UTF8')),'hex') then raise exception 'ai_source_changed'; end if;
  perform ai_private.validate_course(d->'proposal',r.source_handle);
  update public.operation_batches set status='rejected' where id=b.id;
  insert into public.operation_batches(id,user_id,source,status,summary,ai_course_request_id) values(next_id,auth.uid(),'ai','proposed','User-edited course import review',r.id);
  insert into public.operation_steps(user_id,batch_id,position,action_type,target_entity,input) values(auth.uid(),next_id,0,'create_course','course',d->'proposal');
  return next_id;
end $$;

-- Serialize course writes with import duplicate checking. No existing course is edited.
create function public.lock_course_import_owner() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,11));
  return new;
end $$;
create trigger courses_import_owner_lock before insert or update on public.courses for each row execute function public.lock_course_import_owner();

create function public.apply_ai_course_import(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_course_requests%rowtype; s public.operation_steps%rowtype;
  c jsonb; m jsonb; course_id uuid; meeting_id uuid; meeting_ids jsonb:='[]'::jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'approve_course');
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid() for update;
  if not found or b.source<>'ai' or b.ai_course_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_course_requests where id=b.ai_course_request_id and user_id=auth.uid() for update;
  if not found or r.capability<>'courseImport.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status='committed' and r.status='applied' then return jsonb_build_object('ok',true,'alreadyApplied',true); end if;
  if b.status<>'proposed' or r.status<>'proposed' or r.expires_at<=now() then raise exception 'ai_proposal_unavailable'; end if;
  if coalesce((select permission_mode from public.ai_preferences where user_id=auth.uid()),'ask_before_changing')<>'ask_before_changing' then raise exception 'ai_permission_denied'; end if;
  if r.source_digest<>encode(sha256(convert_to(r.source_text,'UTF8')),'hex') then raise exception 'ai_source_changed'; end if;
  if (select count(*) from public.operation_steps where batch_id=b.id)<>1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id=b.id and user_id=auth.uid() and position=0;
  if not found or s.action_type<>'create_course' or s.target_entity<>'course' or s.target_id is not null then raise exception 'ai_invalid_proposal'; end if;
  perform ai_private.validate_course(s.input,r.source_handle);
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text,'UTF8')),'hex') then raise exception 'ai_review_changed'; end if;
  c:=s.input->'course';
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,11));
  if exists(select 1 from public.courses where user_id=auth.uid() and upper(btrim(code))=upper(btrim(c->>'code'))) then
    update public.operation_batches set status='failed' where id=b.id;
    update public.ai_course_requests set status='conflict' where id=r.id;
    return jsonb_build_object('ok',false,'code','course_exists');
  end if;
  update public.operation_batches set status='confirmed' where id=b.id;
  insert into public.courses(user_id,code,name,instructor,location,color) values(auth.uid(),upper(btrim(c->>'code')),btrim(c->>'name'),c->>'instructor',c->>'location',null) returning id into course_id;
  for m in select * from jsonb_array_elements(c->'meetings') loop
    insert into public.course_meetings(user_id,course_id,title,weekdays,start_date,end_date_exclusive,start_time,end_time,time_zone,location)
      values(auth.uid(),course_id,btrim(m->>'title'),array(select (v#>>'{}')::integer from jsonb_array_elements(m->'weekdays') v),r.start_date,null,(m->>'startTime')::time,(m->>'endTime')::time,r.time_zone,coalesce(m->>'location',c->>'location')) returning id into meeting_id;
    meeting_ids:=meeting_ids||jsonb_build_array(meeting_id);
  end loop;
  update public.operation_steps set inverse=jsonb_build_object('created_course_id',course_id,'created_meeting_ids',meeting_ids,'undo_supported',false) where id=s.id;
  update public.operation_batches set status='committed',committed_at=now() where id=b.id;
  update public.ai_course_requests set status='applied' where id=r.id;
  return jsonb_build_object('ok',true,'courseId',course_id,'meetings',jsonb_array_length(meeting_ids));
end $$;

create function public.ai_read_course_review(p_batch_id uuid) returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('batchId',b.id,'status',b.status,'input',s.input,'proposalDigest',encode(sha256(convert_to(s.input::text,'UTF8')),'hex'),
    'sourceHandle',r.source_handle,'capability',r.capability,'fileName',r.file_name,'startDate',r.start_date,'timeZone',r.time_zone)
  from public.operation_batches b join public.ai_course_requests r on r.id=b.ai_course_request_id and r.user_id=auth.uid()
    join public.operation_steps s on s.batch_id=b.id and s.user_id=auth.uid() and s.position=0
  where b.id=p_batch_id and b.user_id=auth.uid() and b.source='ai'
$$;
create function public.ai_reject_course_proposal(p_message text,p_mac text) returns void language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype;
begin
  d:=ai_private.verify_command(p_message,p_mac,'reject_course');
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid() for update;
  if not found or b.source<>'ai' or b.ai_course_request_id is null or b.status<>'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  update public.operation_batches set status='rejected' where id=b.id;
  update public.ai_course_requests set status='rejected' where id=b.ai_course_request_id and user_id=auth.uid();
end $$;

revoke all on function public.ai_create_course_request(text,text),public.ai_record_course_proposal(text,text),public.ai_revise_course_proposal(text,text),public.apply_ai_course_import(text,text),public.ai_reject_course_proposal(text,text),public.ai_read_course_review(uuid) from public,anon;
grant execute on function public.ai_create_course_request(text,text),public.ai_record_course_proposal(text,text),public.ai_revise_course_proposal(text,text),public.apply_ai_course_import(text,text),public.ai_reject_course_proposal(text,text),public.ai_read_course_review(uuid) to authenticated;
