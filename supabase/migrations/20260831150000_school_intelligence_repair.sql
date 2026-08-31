-- Migration: School Intelligence Repair - Scoped AI Request Trust Lifecycle, Atomic Prediction Confirmation, and Scoped Privacy Boundaries
-- Phase: School Intelligence Repair

-- 1. Capability-Specific Cloud Privacy Consent Columns in ai_preferences
alter table public.ai_preferences
  add column if not exists school_schedule_cloud boolean not null default false,
  add column if not exists blackboard_course_cloud boolean not null default false,
  add column if not exists academic_calendar_cloud boolean not null default false,
  add column if not exists assessment_prediction_cloud boolean not null default false,
  add column if not exists notes_cloud boolean not null default false,
  add column if not exists quick_capture_cloud boolean not null default false,
  add column if not exists daily_plan_cloud boolean not null default false,
  add column if not exists course_material_cloud boolean not null default false,
  add column if not exists contextual_assistant_cloud boolean not null default false;

-- 2. Update cloud_allowed to evaluate capability-specific privacy policies
create or replace function ai_private.cloud_allowed(p_capability text, p_provider text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select cloud_enabled and cloud_fallback_mode<>'off' and
    (ai_mode=p_provider or (ai_mode='auto' and (preferred_cloud=p_provider or secondary_cloud))) and
    case p_capability
      when 'taskChecklist.propose' then checklist_cloud
      when 'courseImport.propose' then course_import_cloud
      when 'schoolScheduleImage.propose' then school_schedule_cloud
      when 'blackboardCourseImage.propose' then blackboard_course_cloud
      when 'academicCalendarImport.propose' then academic_calendar_cloud
      when 'schoolAssessmentPrediction.propose' then assessment_prediction_cloud
      when 'noteSummary.propose' then notes_cloud
      when 'noteRewrite.propose' then notes_cloud
      when 'noteActionItems.propose' then notes_cloud
      when 'quickCapture.propose' then quick_capture_cloud
      when 'dailyPlanAdvice.propose' then daily_plan_cloud
      when 'courseMaterialSummary.propose' then course_material_cloud
      when 'courseMaterialStudyQuestions.propose' then course_material_cloud
      when 'contextualAssistant.propose' then contextual_assistant_cloud
      else false
    end
    from public.ai_preferences where user_id=auth.uid()),false)
$$;

-- 3. Dedicated Scoped AI Requests Table
create table if not exists public.ai_scoped_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in (
    'schoolScheduleImage.propose',
    'blackboardCourseImage.propose',
    'academicCalendarImport.propose',
    'schoolAssessmentPrediction.propose',
    'noteSummary.propose',
    'noteRewrite.propose',
    'noteActionItems.propose',
    'quickCapture.propose',
    'dailyPlanAdvice.propose',
    'courseMaterialSummary.propose',
    'courseMaterialStudyQuestions.propose',
    'contextualAssistant.propose'
  )),
  source_handle text not null check (char_length(source_handle) between 3 and 100 and source_handle ~ '^[a-zA-Z0-9_-]+$'),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  source_text text not null,
  file_name text check (file_name is null or char_length(file_name) between 1 and 200),
  start_date date,
  time_zone text,
  provider text not null check (provider in ('ollama','llamacpp','openai_compatible','gemini','openrouter')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  status text not null default 'prepared' check (status in ('prepared','proposed','applied','rejected','conflict')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

alter table public.ai_scoped_requests enable row level security;
revoke all on public.ai_scoped_requests from public, anon, authenticated;
grant select on public.ai_scoped_requests to authenticated;
create policy ai_scoped_requests_owner_read on public.ai_scoped_requests for select to authenticated using (user_id = (select auth.uid()));
create index if not exists ai_scoped_requests_owner_created on public.ai_scoped_requests(user_id, created_at);

-- 4. Connect ai_scoped_requests with operation_batches and operation_steps
alter table public.operation_batches add column if not exists ai_scoped_request_id uuid references public.ai_scoped_requests(id) on delete restrict;
alter table public.operation_batches drop constraint if exists ai_request_domain_exclusive;
alter table public.operation_batches add constraint ai_request_domain_exclusive check (
  (case when ai_request_id is not null then 1 else 0 end +
   case when ai_course_request_id is not null then 1 else 0 end +
   case when ai_scoped_request_id is not null then 1 else 0 end) <= 1
);

create unique index if not exists ai_scoped_one_pending_review on public.operation_batches(ai_scoped_request_id) where status = 'proposed' and ai_scoped_request_id is not null;

-- Expand operation_steps target entities
alter table public.operation_steps drop constraint if exists operation_steps_target;
alter table public.operation_steps add constraint operation_steps_target check (
  target_entity is null
  or target_entity in ('task','event','note','notion_page','work_session','course','academic_calendar','assessment_prediction','course_material','daily_plan','contextual_assistant')
);

-- Update restrictive RLS guards
alter policy ai_batches_insert_guard on public.operation_batches with check (source <> 'ai' and ai_request_id is null and ai_course_request_id is null and ai_scoped_request_id is null);
alter policy ai_batches_update_guard on public.operation_batches using (source <> 'ai' and ai_request_id is null and ai_course_request_id is null and ai_scoped_request_id is null) with check (source <> 'ai' and ai_request_id is null and ai_course_request_id is null and ai_scoped_request_id is null);
alter policy ai_batches_delete_guard on public.operation_batches using (source <> 'ai' and ai_request_id is null and ai_course_request_id is null and ai_scoped_request_id is null);

alter policy ai_steps_insert_guard on public.operation_steps with check (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null and b.ai_scoped_request_id is null));
alter policy ai_steps_update_guard on public.operation_steps using (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null and b.ai_scoped_request_id is null)) with check (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null and b.ai_scoped_request_id is null));
alter policy ai_steps_delete_guard on public.operation_steps using (exists(select 1 from public.operation_batches b where b.id=batch_id and b.source <> 'ai' and b.ai_request_id is null and b.ai_course_request_id is null and b.ai_scoped_request_id is null));

-- 5. Update ai_inference_attempts to support scoped requests
alter table public.ai_inference_attempts add column if not exists scoped_request_id uuid references public.ai_scoped_requests(id) on delete cascade;
alter table public.ai_inference_attempts drop constraint if exists ai_inference_attempts_capability_check;
alter table public.ai_inference_attempts add constraint ai_inference_attempts_capability_check check (
  capability in (
    'taskChecklist.propose',
    'courseImport.propose',
    'schoolScheduleImage.propose',
    'blackboardCourseImage.propose',
    'academicCalendarImport.propose',
    'schoolAssessmentPrediction.propose',
    'noteSummary.propose',
    'noteRewrite.propose',
    'noteActionItems.propose',
    'quickCapture.propose',
    'dailyPlanAdvice.propose',
    'courseMaterialSummary.propose',
    'courseMaterialStudyQuestions.propose',
    'contextualAssistant.propose'
  )
);
alter table public.ai_inference_attempts drop constraint if exists ai_inference_attempts_check;
alter table public.ai_inference_attempts drop constraint if exists ai_inference_attempts_source_exclusive;
alter table public.ai_inference_attempts add constraint ai_inference_attempts_source_exclusive check (
  num_nonnulls(checklist_request_id, course_request_id, scoped_request_id) = 1
);
create unique index if not exists ai_inference_scoped_provider on public.ai_inference_attempts(scoped_request_id, provider);
create unique index if not exists ai_inference_scoped_active on public.ai_inference_attempts(scoped_request_id) where status in ('ready','awaiting_consent','dispatching','succeeded');

create or replace function public.ai_inference_owner_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.checklist_request_id is not null and not exists(select 1 from public.ai_requests where id=new.checklist_request_id and user_id=new.user_id))
    or (new.course_request_id is not null and not exists(select 1 from public.ai_course_requests where id=new.course_request_id and user_id=new.user_id))
    or (new.scoped_request_id is not null and not exists(select 1 from public.ai_scoped_requests where id=new.scoped_request_id and user_id=new.user_id))
    or (new.parent_id is not null and not exists(select 1 from public.ai_inference_attempts where id=new.parent_id and user_id=new.user_id))
    or (new.batch_id is not null and not exists(select 1 from public.operation_batches where id=new.batch_id and user_id=new.user_id))
    then raise exception 'ai_owner_mismatch'; end if;
  return new;
end $$;

create or replace function ai_private.inference_source(p_checklist uuid, p_course uuid, p_scoped uuid default null) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare r public.ai_requests%rowtype; c public.ai_course_requests%rowtype; s public.ai_scoped_requests%rowtype; context jsonb;
begin
  if num_nonnulls(p_checklist, p_course, p_scoped) <> 1 then raise exception 'ai_capability_denied'; end if;
  if p_checklist is not null then
    select * into r from public.ai_requests where id=p_checklist and user_id=auth.uid() for update;
    if not found or r.status<>'prepared' or r.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
    context:=public.ai_read_task_context(r.task_id);
    if context->>'revision' is distinct from r.source_revision then raise exception 'ai_source_changed'; end if;
    return r.expires_at;
  elsif p_course is not null then
    select * into c from public.ai_course_requests where id=p_course and user_id=auth.uid() for update;
    if not found or c.status<>'prepared' or c.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
    if c.source_digest<>encode(sha256(convert_to(c.source_text,'UTF8')),'hex') then raise exception 'ai_source_changed'; end if;
    return c.expires_at;
  else
    select * into s from public.ai_scoped_requests where id=p_scoped and user_id=auth.uid() for update;
    if not found or s.status<>'prepared' or s.expires_at<=now() then raise exception 'ai_request_unavailable'; end if;
    if s.source_digest<>encode(sha256(convert_to(s.source_text,'UTF8')),'hex') then raise exception 'ai_source_changed'; end if;
    return s.expires_at;
  end if;
end $$;
revoke all on function ai_private.inference_source(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.ai_prepare_inference(p_message text, p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; parent public.ai_inference_attempts%rowtype; expiry timestamptz; ck uuid; cr uuid; sr uuid;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_inference');
  ck:=(d->>'checklist_request_id')::uuid; cr:=(d->>'course_request_id')::uuid; sr:=(d->>'scoped_request_id')::uuid;
  expiry:=ai_private.inference_source(ck,cr,sr);
  if d->>'location'='cloud' and not ai_private.cloud_allowed(d->>'capability',d->>'provider') then raise exception 'ai_cloud_denied'; end if;
  if d->>'parent_id' is not null then
    select * into parent from public.ai_inference_attempts where id=(d->>'parent_id')::uuid and user_id=auth.uid() for update;
    if not found or parent.status<>'failed' or parent.checklist_request_id is distinct from ck or parent.course_request_id is distinct from cr or parent.scoped_request_id is distinct from sr
      or coalesce((select ai_mode from public.ai_preferences where user_id=auth.uid()),'local')<>'auto'
      or not (parent.error_code in ('provider_unavailable','rate_limited','missing_credentials','local_unavailable')
        or (parent.location<>'cloud' and parent.error_code in ('timeout','network_unavailable')))
      then raise exception 'ai_fallback_denied'; end if;
  end if;
  if (select count(*) from public.ai_inference_attempts where (ck is not null and checklist_request_id=ck) or (cr is not null and course_request_id=cr) or (sr is not null and scoped_request_id=sr))>=3 then raise exception 'ai_route_exhausted'; end if;
  insert into public.ai_inference_attempts(id,user_id,checklist_request_id,course_request_id,scoped_request_id,parent_id,provider,model,location,capability,payload_digest,text_bytes,status,expires_at)
  values((d->>'id')::uuid,auth.uid(),ck,cr,sr,(d->>'parent_id')::uuid,d->>'provider',d->>'model',d->>'location',d->>'capability',d->>'payload_digest',(d->>'text_bytes')::integer,
    case when d->>'location'='cloud' then 'awaiting_consent' else 'ready' end,expiry);
  return (d->>'id')::uuid;
end $$;

create or replace function public.ai_claim_inference(p_message text, p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb; a public.ai_inference_attempts%rowtype;
begin
  d:=ai_private.verify_command(p_message,p_mac,'claim_inference');
  select * into a from public.ai_inference_attempts where id=(d->>'id')::uuid and user_id=auth.uid() for update;
  if not found or a.status not in ('ready','awaiting_consent') or a.expires_at<=now() or a.payload_digest is distinct from d->>'payload_digest'
    then raise exception 'ai_transfer_unavailable'; end if;
  perform ai_private.inference_source(a.checklist_request_id,a.course_request_id,a.scoped_request_id);
  if a.location='cloud' and (not ai_private.cloud_allowed(a.capability,a.provider) or (d->'consent') is distinct from 'true'::jsonb)
    then raise exception 'ai_cloud_denied'; end if;
  update public.ai_inference_attempts set status='dispatching',claimed_at=clock_timestamp(),
    consented_at=case when a.location='cloud' then clock_timestamp() else null end where id=a.id;
end $$;

create or replace function public.ai_finish_inference(p_message text, p_mac text) returns void
language plpgsql security definer set search_path='' as $$
declare d jsonb; a public.ai_inference_attempts%rowtype; b public.operation_batches%rowtype;
begin
  d:=ai_private.verify_command(p_message,p_mac,'finish_inference');
  select * into a from public.ai_inference_attempts where id=(d->>'id')::uuid and user_id=auth.uid() for update;
  if not found or a.status not in ('ready','awaiting_consent','dispatching') then raise exception 'ai_transfer_unavailable'; end if;
  if d->>'status'='cancelled' and a.status='dispatching' then raise exception 'ai_transfer_unavailable'; end if;
  if d->>'status'='succeeded' then
    if a.status<>'dispatching' then raise exception 'ai_transfer_unavailable'; end if;
    select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid();
    if not found or b.source<>'ai' or b.ai_request_id is distinct from a.checklist_request_id or b.ai_course_request_id is distinct from a.course_request_id or b.ai_scoped_request_id is distinct from a.scoped_request_id
      then raise exception 'ai_untrusted_proposal'; end if;
  elsif d->>'status' not in ('failed','cancelled') then raise exception 'ai_transfer_unavailable'; end if;
  update public.ai_inference_attempts set status=d->>'status',error_code=d->>'error_code',completed_at=clock_timestamp(),
    latency_ms=(d->>'latency_ms')::integer,batch_id=(d->>'batch_id')::uuid where id=a.id;
end $$;

create or replace function public.ai_read_inference_provenance(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('provider',a.provider,'model',a.model,'location',a.location,
    'evidence',case when a.location='cloud' then 'server_response' else 'browser_relay' end,'latencyMs',a.latency_ms)
  from public.operation_batches b join public.ai_inference_attempts a on
    (a.checklist_request_id=b.ai_request_id or a.course_request_id=b.ai_course_request_id or a.scoped_request_id=b.ai_scoped_request_id)
  where b.id=p_batch_id and b.user_id=auth.uid() and a.user_id=auth.uid() and a.status='succeeded'
$$;

-- 6. Scoped Request Preparation & Review RPCs
create or replace function public.ai_create_scoped_request(p_message text, p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; request_id uuid;
begin
  d := ai_private.verify_command(p_message, p_mac, 'prepare_scoped_request');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 12));
  if (select count(*) from public.ai_scoped_requests where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'ai_rate_limited'; end if;
  if (d->>'source_digest') is distinct from encode(sha256(convert_to(d->>'source_text', 'UTF8')), 'hex') then
    raise exception 'ai_invalid_source'; end if;
  request_id := (d->>'id')::uuid;
  insert into public.ai_scoped_requests(id, user_id, capability, source_handle, source_digest, source_text, file_name, start_date, time_zone, provider, model)
    values(request_id, auth.uid(), d->>'capability', d->>'source_handle', d->>'source_digest', d->>'source_text', d->>'file_name', (d->>'start_date')::date, d->>'time_zone', d->>'provider', d->>'model');
  return request_id;
end $$;

create or replace function public.ai_record_scoped_proposal(p_message text, p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; r public.ai_scoped_requests%rowtype; batch_id uuid := gen_random_uuid();
begin
  d := ai_private.verify_command(p_message, p_mac, 'record_scoped_proposal');
  select * into r from public.ai_scoped_requests where id = (d->>'request_id')::uuid and user_id = auth.uid() for update;
  if not found or r.status <> 'prepared' or r.expires_at <= now() then raise exception 'ai_request_unavailable'; end if;
  if r.source_digest <> encode(sha256(convert_to(r.source_text, 'UTF8')), 'hex') then raise exception 'ai_source_changed'; end if;
  insert into public.operation_batches(id, user_id, source, status, summary, ai_scoped_request_id)
    values(batch_id, auth.uid(), 'ai', 'proposed', coalesce(d->>'summary', 'AI proposal review'), r.id);
  insert into public.operation_steps(user_id, batch_id, position, action_type, target_entity, input)
    values(auth.uid(), batch_id, 0, r.capability, coalesce(d->>'target_entity', 'course'), d->'proposal');
  update public.ai_scoped_requests set status = 'proposed' where id = r.id;
  return batch_id;
end $$;

create or replace function public.ai_revise_scoped_proposal(p_message text, p_mac text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; next_id uuid := gen_random_uuid();
begin
  d := ai_private.verify_command(p_message, p_mac, 'revise_scoped_proposal');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null or b.status <> 'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_request_unavailable'; end if;
  if r.source_digest <> encode(sha256(convert_to(r.source_text, 'UTF8')), 'hex') then raise exception 'ai_source_changed'; end if;
  update public.operation_batches set status = 'rejected' where id = b.id;
  insert into public.operation_batches(id, user_id, source, status, summary, ai_scoped_request_id)
    values(next_id, auth.uid(), 'ai', 'proposed', coalesce(d->>'summary', 'User-edited proposal review'), r.id);
  insert into public.operation_steps(user_id, batch_id, position, action_type, target_entity, input)
    values(auth.uid(), next_id, 0, r.capability, coalesce(d->>'target_entity', 'course'), d->'proposal');
  return next_id;
end $$;

create or replace function public.ai_reject_scoped_proposal(p_message text, p_mac text) returns void
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype;
begin
  d := ai_private.verify_command(p_message, p_mac, 'reject_scoped_proposal');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null or b.status <> 'proposed' then raise exception 'ai_proposal_unavailable'; end if;
  update public.operation_batches set status = 'rejected' where id = b.id;
  update public.ai_scoped_requests set status = 'rejected' where id = b.ai_scoped_request_id and user_id = auth.uid();
end $$;

create or replace function public.ai_read_scoped_review(p_batch_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('batchId', b.id, 'status', b.status, 'input', s.input,
    'proposalDigest', encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex'),
    'sourceHandle', r.source_handle, 'capability', r.capability, 'fileName', r.file_name,
    'startDate', r.start_date, 'timeZone', r.time_zone,
    'provenance', public.ai_read_inference_provenance(b.id))
  from public.operation_batches b
    join public.ai_scoped_requests r on r.id = b.ai_scoped_request_id and r.user_id = auth.uid()
    join public.operation_steps s on s.batch_id = b.id and s.user_id = auth.uid() and s.position = 0
  where b.id = p_batch_id and b.user_id = auth.uid() and b.source = 'ai'
$$;

-- 7. Domain Apply RPCs

-- 7A. Apply Schedule Screenshot Import (Creates Courses & Course Meetings Atomically)
create or replace function public.apply_ai_schedule_import(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  course_item jsonb; meeting_item jsonb; course_id uuid; meeting_id uuid;
  created_course_ids jsonb := '[]'::jsonb; created_meeting_ids jsonb := '[]'::jsonb;
  today_date date; tzone text;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_schedule_import');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'schoolScheduleImage.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  today_date := coalesce(r.start_date, current_date);
  tzone := coalesce(r.time_zone, 'UTC');

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 13));
  update public.operation_batches set status = 'confirmed' where id = b.id;

  for course_item in select * from jsonb_array_elements(s.input->'courses') loop
    -- Match existing course by code or create new
    select id into course_id from public.courses where user_id = auth.uid() and upper(btrim(code)) = upper(btrim(course_item->>'code'));
    if course_id is null then
      insert into public.courses(user_id, code, name, color)
        values(auth.uid(), upper(btrim(course_item->>'code')), btrim(course_item->>'title'), coalesce(course_item->>'color', '#2563EB'))
        returning id into course_id;
      created_course_ids := created_course_ids || jsonb_build_array(course_id);
    end if;

    -- Insert meetings
    for meeting_item in select * from jsonb_array_elements(course_item->'meetings') loop
      declare
        wday_num integer;
        wday_str text := lower(btrim(meeting_item->>'weekday'));
      begin
        wday_num := case wday_str
          when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
          when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6 else 1 end;
        insert into public.course_meetings(user_id, course_id, title, weekdays, start_date, start_time, end_time, time_zone, location)
          values(auth.uid(), course_id,
            case when (course_item->>'section') is not null and btrim(course_item->>'section') <> ''
                 then btrim(course_item->>'title') || ' (' || btrim(course_item->>'section') || ')'
                 else btrim(course_item->>'title') end,
            array[wday_num], today_date,
            (meeting_item->>'startTime')::time, (meeting_item->>'endTime')::time,
            tzone, meeting_item->>'room')
          returning id into meeting_id;
        created_meeting_ids := created_meeting_ids || jsonb_build_array(meeting_id);
      end;
    end loop;
  end loop;

  update public.operation_steps set inverse = jsonb_build_object('created_course_ids', created_course_ids, 'created_meeting_ids', created_meeting_ids, 'undo_supported', false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'coursesCreated', jsonb_array_length(created_course_ids), 'meetingsCreated', jsonb_array_length(created_meeting_ids));
end $$;

-- 7B. Apply Blackboard Screenshot Courses (Creates Canonical Courses strictly, zero fake mappings)
create or replace function public.apply_ai_blackboard_courses(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  course_item jsonb; course_id uuid; created_course_ids jsonb := '[]'::jsonb;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_blackboard_courses');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'blackboardCourseImage.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 14));
  update public.operation_batches set status = 'confirmed' where id = b.id;

  for course_item in select * from jsonb_array_elements(s.input->'courses') loop
    if (course_item->>'action') = 'ignore' then continue; end if;
    if (course_item->>'action') = 'match' and (course_item->>'matchedCourseId') is not null then
      -- Verify matched course belongs to user
      perform id from public.courses where id = (course_item->>'matchedCourseId')::uuid and user_id = auth.uid();
      if not found then raise exception 'ai_untrusted_proposal'; end if;
    else
      -- Create new canonical course if not already existing
      select id into course_id from public.courses where user_id = auth.uid() and upper(btrim(code)) = upper(btrim(course_item->>'code'));
      if course_id is null then
        insert into public.courses(user_id, code, name, color)
          values(auth.uid(), upper(btrim(course_item->>'code')), btrim(course_item->>'title'), '#2563EB')
          returning id into course_id;
        created_course_ids := created_course_ids || jsonb_build_array(course_id);
      end if;
    end if;
  end loop;

  update public.operation_steps set inverse = jsonb_build_object('created_course_ids', created_course_ids, 'undo_supported', false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'coursesCreated', jsonb_array_length(created_course_ids));
end $$;

-- 7C. Apply Academic Calendar Import (Deduplicates with stable identity, handles updates/divergence)
create or replace function public.apply_ai_academic_calendar(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  ev jsonb; ext_id text; existing_id uuid; created_count integer := 0; updated_count integer := 0;
  start_inst timestamptz; end_inst timestamptz;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_academic_calendar');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'academicCalendarImport.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 15));
  update public.operation_batches set status = 'confirmed' where id = b.id;

  for ev in select * from jsonb_array_elements(s.input->'events') loop
    -- Stable source identity based on normalized title/source identifier
    ext_id := 'acad_' || substr(encode(sha256(convert_to(lower(btrim(ev->>'title')), 'UTF8')), 'hex'), 1, 32);

    if (ev->>'startDate') like '%T%' then
      start_inst := (ev->>'startDate')::timestamptz;
    else
      start_inst := ((ev->>'startDate') || 'T00:00:00Z')::timestamptz;
    end if;

    if (ev->>'endDate') is not null and btrim(ev->>'endDate') <> '' then
      if (ev->>'endDate') like '%T%' then
        end_inst := (ev->>'endDate')::timestamptz;
      else
        end_inst := ((ev->>'endDate') || 'T23:59:59Z')::timestamptz;
      end if;
    else
      if (ev->>'startDate') like '%T%' then
        end_inst := start_inst + interval '1 hour';
      else
        end_inst := ((ev->>'startDate') || 'T23:59:59Z')::timestamptz;
      end if;
    end if;

    -- Look up existing academic calendar event by owner and stable external_id
    select id into existing_id from public.calendar_events
      where user_id = auth.uid() and source = 'academic_calendar' and external_id = ext_id;

    if existing_id is not null then
      -- Update existing imported event (preserves identity without creating duplicate)
      update public.calendar_events
        set title = btrim(ev->>'title'),
            description = ev->>'description',
            starts_at = start_inst,
            ends_at = end_inst,
            all_day = coalesce((ev->>'allDay')::boolean, true),
            event_type = coalesce(ev->>'eventType', 'event'),
            updated_at = now()
        where id = existing_id and user_id = auth.uid();
      updated_count := updated_count + 1;
    else
      insert into public.calendar_events(user_id, title, description, starts_at, ends_at, all_day, event_type, source, external_id)
        values(auth.uid(), btrim(ev->>'title'), ev->>'description', start_inst, end_inst, coalesce((ev->>'allDay')::boolean, true), coalesce(ev->>'eventType', 'event'), 'academic_calendar', ext_id);
      created_count := created_count + 1;
    end if;
  end loop;

  update public.operation_steps set inverse = jsonb_build_object('created_count', created_count, 'updated_count', updated_count, 'undo_supported', false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'created', created_count, 'updated', updated_count);
end $$;

-- 7D. Apply Assessment Predictions
create or replace function public.apply_ai_assessment_predictions(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  pred jsonb; count_inserted integer := 0; cid uuid;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_assessment_predictions');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'schoolAssessmentPrediction.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 16));
  update public.operation_batches set status = 'confirmed' where id = b.id;

  for pred in select * from jsonb_array_elements(s.input->'predictions') loop
    cid := (pred->>'courseId')::uuid;
    -- Verify course belongs to owner
    if not exists(select 1 from public.courses where id = cid and user_id = auth.uid()) then
      raise exception 'ai_untrusted_proposal';
    end if;

    insert into public.school_assessment_predictions(
      user_id, course_id, prediction_type, title, predicted_date, predicted_time, confidence, status, rationale, source_reference
    ) values (
      auth.uid(), cid, pred->>'predictionType', btrim(pred->>'title'),
      (pred->>'predictedDate')::date, pred->>'predictedTime',
      pred->>'confidence', 'active', btrim(pred->>'rationale'), pred->>'sourceReference'
    );
    count_inserted := count_inserted + 1;
  end loop;

  update public.operation_steps set inverse = jsonb_build_object('inserted_count', count_inserted, 'undo_supported', false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'count', count_inserted);
end $$;

-- 7E. Atomic Prediction Confirmation RPCs (SI-04 / SI-05 Repair)
create or replace function public.confirm_prediction_to_task(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; p public.school_assessment_predictions%rowtype; new_task_id uuid;
  due_at_val timestamptz := null;
begin
  d := ai_private.verify_command(p_message, p_mac, 'confirm_prediction_task');
  select * into p from public.school_assessment_predictions
    where id = (d->>'prediction_id')::uuid and user_id = auth.uid() for update;
  if not found or p.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'prediction_unavailable');
  end if;

  if p.predicted_time is not null and p.predicted_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    due_at_val := ((p.predicted_date::text) || 'T' || p.predicted_time || ':00Z')::timestamptz;
  end if;

  insert into public.tasks(
    user_id, title, due_date, due_at, course_id, priority, status
  ) values (
    auth.uid(),
    coalesce(btrim(d->>'title'), p.title),
    coalesce((d->>'dueDate')::date, p.predicted_date),
    due_at_val,
    p.course_id,
    coalesce(d->>'priority', 'none')::public.task_priority,
    'todo'
  ) returning id into new_task_id;

  -- Atomically transition status to confirmed
  perform set_config('ai.confirming_prediction', 'true', true);
  update public.school_assessment_predictions
    set status = 'confirmed', updated_at = now()
    where id = p.id and user_id = auth.uid();

  return jsonb_build_object('ok', true, 'taskId', new_task_id);
end $$;

create or replace function public.confirm_prediction_to_event(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; p public.school_assessment_predictions%rowtype; new_event_id uuid;
  s_time timestamptz; e_time timestamptz;
begin
  d := ai_private.verify_command(p_message, p_mac, 'confirm_prediction_event');
  select * into p from public.school_assessment_predictions
    where id = (d->>'prediction_id')::uuid and user_id = auth.uid() for update;
  if not found or p.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'prediction_unavailable');
  end if;

  s_time := ((p.predicted_date::text) || 'T00:00:00Z')::timestamptz;
  e_time := ((p.predicted_date::text) || 'T23:59:59Z')::timestamptz;

  insert into public.calendar_events(
    user_id, title, starts_at, ends_at, all_day, event_type, source
  ) values (
    auth.uid(),
    coalesce(btrim(d->>'title'), p.title),
    s_time, e_time, true, 'assessment', 'life_os'
  ) returning id into new_event_id;

  perform set_config('ai.confirming_prediction', 'true', true);
  update public.school_assessment_predictions
    set status = 'confirmed', updated_at = now()
    where id = p.id and user_id = auth.uid();

  return jsonb_build_object('ok', true, 'eventId', new_event_id);
end $$;

-- Update school_prediction_state_guard to permit transitions to 'confirmed' via internal state update
create or replace function public.school_prediction_state_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then raise exception 'Prediction must start active'; end if;
  elsif new.status is distinct from old.status then
    if old.status <> 'active' then
      raise exception 'Prediction transition unavailable';
    end if;
    if new.status = 'confirmed' then
      if current_setting('ai.confirming_prediction', true) is distinct from 'true' then
        raise exception 'Prediction transition unavailable pending reviewed confirmation';
      end if;
    elsif new.status not in ('dismissed', 'superseded') then
      raise exception 'Prediction transition unavailable';
    end if;
  end if;
  return new;
end $$;

-- 7F. Apply Note Rewrite
create or replace function public.apply_ai_note_rewrite(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  nid uuid; n public.notes%rowtype; new_body text; mode_str text;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_note_rewrite');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'noteRewrite.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  nid := (d->>'note_id')::uuid;
  select * into n from public.notes where id = nid and user_id = auth.uid() for update;
  if not found then raise exception 'ai_source_unavailable'; end if;

  mode_str := coalesce(s.input->>'mode', 'replace');
  if mode_str = 'append' then
    new_body := n.body || E'\n\n---\n\n' || (s.input->>'rewritten_body');
  else
    new_body := (s.input->>'rewritten_body');
  end if;

  update public.operation_batches set status = 'confirmed' where id = b.id;
  update public.notes set body = new_body, updated_at = now() where id = n.id and user_id = auth.uid();
  update public.operation_steps set inverse = jsonb_build_object('note_id', n.id, 'undo_supported', false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'newBody', new_body);
end $$;

-- 7G. Apply Note Action Items
create or replace function public.apply_ai_note_action_items(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  item jsonb; nid uuid; n public.notes%rowtype; task_id uuid; created_ids jsonb := '[]'::jsonb;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_note_action_items');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'noteActionItems.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  nid := (d->>'note_id')::uuid;
  select * into n from public.notes where id = nid and user_id = auth.uid();

  update public.operation_batches set status = 'confirmed' where id = b.id;

  for item in select * from jsonb_array_elements(s.input->'items') loop
    insert into public.tasks(
      user_id, title, due_date, course_id, priority, status
    ) values (
      auth.uid(),
      btrim(item->>'title'),
      (item->>'dueDate')::date,
      n.course_id,
      coalesce(item->>'priority', 'none')::public.task_priority,
      'todo'
    ) returning id into task_id;
    created_ids := created_ids || jsonb_build_array(task_id);
  end loop;

  update public.operation_steps set inverse = jsonb_build_object('created_task_ids', created_ids, 'undo_supported', false) where id = s.id;
  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(created_ids));
end $$;

-- 7H. Apply Quick Capture
create or replace function public.apply_ai_quick_capture(p_message text, p_mac text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
  prop jsonb; task_id uuid; event_id uuid; course_id_val uuid := null;
  due_at_val timestamptz := null; s_inst timestamptz; e_inst timestamptz;
begin
  d := ai_private.verify_command(p_message, p_mac, 'approve_quick_capture');
  select * into b from public.operation_batches where id = (d->>'batch_id')::uuid and user_id = auth.uid() for update;
  if not found or b.source <> 'ai' or b.ai_scoped_request_id is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id = b.ai_scoped_request_id and user_id = auth.uid() for update;
  if not found or r.capability <> 'quickCapture.propose' then raise exception 'ai_untrusted_proposal'; end if;
  if b.status = 'committed' and r.status = 'applied' then return jsonb_build_object('ok', true, 'alreadyApplied', true); end if;
  if b.status <> 'proposed' or r.status <> 'proposed' or r.expires_at <= now() then raise exception 'ai_proposal_unavailable'; end if;
  if (select count(*) from public.operation_steps where batch_id = b.id) <> 1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where batch_id = b.id and user_id = auth.uid() and position = 0;
  if not found then raise exception 'ai_invalid_proposal'; end if;
  if (d->>'proposal_digest') is distinct from encode(sha256(convert_to(s.input::text, 'UTF8')), 'hex') then raise exception 'ai_review_changed'; end if;

  prop := s.input;
  update public.operation_batches set status = 'confirmed' where id = b.id;

  if (prop->>'capture_type') = 'task' or (prop->'task') is not null then
    declare tprop jsonb := coalesce(prop->'task', prop);
    begin
      if (tprop->>'courseCode') is not null and btrim(tprop->>'courseCode') <> '' then
        select id into course_id_val from public.courses where user_id = auth.uid() and upper(btrim(code)) = upper(btrim(tprop->>'courseCode'));
      end if;

      if (tprop->>'dueDate') is not null and (tprop->>'dueTime') is not null then
        due_at_val := ((tprop->>'dueDate') || 'T' || (tprop->>'dueTime') || ':00Z')::timestamptz;
      end if;

      insert into public.tasks(
        user_id, title, due_date, due_at, course_id, priority, status
      ) values (
        auth.uid(),
        btrim(tprop->>'title'),
        (tprop->>'dueDate')::date,
        due_at_val,
        course_id_val,
        coalesce(tprop->>'priority', 'none')::public.task_priority,
        'todo'
      ) returning id into task_id;

      update public.operation_steps set inverse = jsonb_build_object('task_id', task_id, 'undo_supported', false) where id = s.id;
    end;
  elsif (prop->>'capture_type') = 'event' or (prop->'event') is not null then
    declare eprop jsonb := coalesce(prop->'event', prop);
    begin
      if (eprop->>'startTime') is not null and btrim(eprop->>'startTime') <> '' then
        s_inst := ((eprop->>'startDate') || 'T' || (eprop->>'startTime') || ':00Z')::timestamptz;
      else
        s_inst := ((eprop->>'startDate') || 'T00:00:00Z')::timestamptz;
      end if;

      if (eprop->>'endTime') is not null and btrim(eprop->>'endTime') <> '' then
        e_inst := (coalesce(eprop->>'endDate', eprop->>'startDate') || 'T' || (eprop->>'endTime') || ':00Z')::timestamptz;
      else
        e_inst := s_inst + interval '1 hour';
      end if;

      insert into public.calendar_events(
        user_id, title, description, starts_at, ends_at, all_day, event_type, source
      ) values (
        auth.uid(),
        btrim(eprop->>'title'),
        case when (eprop->>'location') is not null then 'Location: ' || (eprop->>'location') else null end,
        s_inst, e_inst,
        coalesce((eprop->>'allDay')::boolean, false),
        'event', 'life_os'
      ) returning id into event_id;

      update public.operation_steps set inverse = jsonb_build_object('event_id', event_id, 'undo_supported', false) where id = s.id;
    end;
  else
    raise exception 'ai_invalid_proposal';
  end if;

  update public.operation_batches set status = 'committed', committed_at = now() where id = b.id;
  update public.ai_scoped_requests set status = 'applied' where id = r.id;
  return jsonb_build_object('ok', true, 'taskId', task_id, 'eventId', event_id);
end $$;

-- 8. Grants and Revocations
revoke all on function public.ai_create_scoped_request(text,text) from public, anon;
revoke all on function public.ai_record_scoped_proposal(text,text) from public, anon;
revoke all on function public.ai_revise_scoped_proposal(text,text) from public, anon;
revoke all on function public.ai_reject_scoped_proposal(text,text) from public, anon;
revoke all on function public.ai_read_scoped_review(uuid) from public, anon;

revoke all on function public.apply_ai_schedule_import(text,text) from public, anon;
revoke all on function public.apply_ai_blackboard_courses(text,text) from public, anon;
revoke all on function public.apply_ai_academic_calendar(text,text) from public, anon;
revoke all on function public.apply_ai_assessment_predictions(text,text) from public, anon;
revoke all on function public.confirm_prediction_to_task(text,text) from public, anon;
revoke all on function public.confirm_prediction_to_event(text,text) from public, anon;
revoke all on function public.apply_ai_note_rewrite(text,text) from public, anon;
revoke all on function public.apply_ai_note_action_items(text,text) from public, anon;
revoke all on function public.apply_ai_quick_capture(text,text) from public, anon;

grant execute on function public.ai_create_scoped_request(text,text) to authenticated;
grant execute on function public.ai_record_scoped_proposal(text,text) to authenticated;
grant execute on function public.ai_revise_scoped_proposal(text,text) to authenticated;
grant execute on function public.ai_reject_scoped_proposal(text,text) to authenticated;
grant execute on function public.ai_read_scoped_review(uuid) to authenticated;

grant execute on function public.apply_ai_schedule_import(text,text) to authenticated;
grant execute on function public.apply_ai_blackboard_courses(text,text) to authenticated;
grant execute on function public.apply_ai_academic_calendar(text,text) to authenticated;
grant execute on function public.apply_ai_assessment_predictions(text,text) to authenticated;
grant execute on function public.confirm_prediction_to_task(text,text) to authenticated;
grant execute on function public.confirm_prediction_to_event(text,text) to authenticated;
grant execute on function public.apply_ai_note_rewrite(text,text) to authenticated;
grant execute on function public.apply_ai_note_action_items(text,text) to authenticated;
grant execute on function public.apply_ai_quick_capture(text,text) to authenticated;
