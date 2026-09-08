-- Preserve the finite table registry while adding the two conversion capabilities.
alter table public.ai_scoped_requests drop constraint ai_scoped_requests_capability_check;
alter table public.ai_scoped_requests add constraint ai_scoped_requests_capability_check check(capability in (
 'schoolScheduleImage.propose','blackboardCourseImage.propose','academicCalendarImport.propose','schoolAssessmentPrediction.propose',
 'noteSummary.propose','noteRewrite.propose','noteActionItems.propose','quickCapture.propose','dailyPlanAdvice.propose',
 'courseMaterialSummary.propose','courseMaterialStudyQuestions.propose','contextualAssistant.propose','predictionTask.propose','predictionEvent.propose'));

-- Current-phase mutations use the existing exact review and transaction claim.
create function ai_private.mutation_text_capability(cap text) returns boolean
language sql immutable set search_path='' as $$ select coalesce(cap in ('noteSummary.propose','noteRewrite.propose','noteActionItems.propose','quickCapture.propose'),false) $$;
create function ai_private.prediction_conversion_capability(cap text) returns boolean
language sql immutable set search_path='' as $$ select coalesce(cap in ('predictionTask.propose','predictionEvent.propose'),false) $$;

create function ai_private.strict_day(v jsonb) returns date
language plpgsql set search_path='' as $$ declare d date;begin
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'ai_invalid_proposal';end if;
  d:=(v#>>'{}')::date;if to_char(d,'YYYY-MM-DD') is distinct from v#>>'{}' then raise exception 'ai_invalid_proposal';end if;return d;
end $$;
create function ai_private.strict_clock(v jsonb) returns time
language plpgsql set search_path='' as $$ begin
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'ai_invalid_proposal';end if;return (v#>>'{}')::time;
end $$;
create function ai_private.wall_instant(d date,t time,z text) returns timestamptz
language plpgsql set search_path='' as $$ declare wall timestamp:=d+t;v timestamptz;begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=z) then raise exception 'ai_invalid_time_zone';end if;
  v:=wall at time zone z;
  if v at time zone z is distinct from wall then raise exception 'ai_invalid_local_time';end if;
  -- Resolve repeated clocks to the earlier instant, as the native domain does.
  select min(g) into v from generate_series(v-interval '24 hours',v+interval '24 hours',interval '15 minutes') g where g at time zone z=wall;
  return v;
end $$;

-- A single strict representation shared with TypeScript; no model-supplied IDs,
-- operations, URLs, target fields, inferred default dates or enum coercion.
create function ai_private.validate_capture_item(c jsonb) returns void
language plpgsql set search_path='' as $$ declare d date;e date;t time;u time;begin
  if c->>'entityType'='task' then
    perform ai_private.exact_keys(c,array['entityType','title','timeZone'],array['dueDate','dueTime','priority']);
    if c ? 'dueDate' then d:=ai_private.strict_day(c->'dueDate');end if;
    if c ? 'dueTime' then t:=ai_private.strict_clock(c->'dueTime');if d is null then raise exception 'ai_invalid_proposal';end if;end if;
    if c ? 'priority' and coalesce(c->>'priority','') not in ('low','medium','high','urgent') then raise exception 'ai_invalid_proposal';end if;
  elsif c->>'entityType'='calendar_event' then
    perform ai_private.exact_keys(c,array['entityType','title','timeZone','startDate','endDate','allDay'],array['startTime','endTime','location']);
    d:=ai_private.strict_day(c->'startDate');e:=ai_private.strict_day(c->'endDate');
    if jsonb_typeof(c->'allDay') is distinct from 'boolean' then raise exception 'ai_invalid_proposal';end if;
    if (c->>'allDay')::boolean then
      if c ? 'startTime' or c ? 'endTime' or e<=d then raise exception 'ai_invalid_proposal';end if;
    else
      t:=ai_private.strict_clock(c->'startTime');u:=ai_private.strict_clock(c->'endTime');
      if e+u<=d+t then raise exception 'ai_invalid_proposal';end if;
    end if;
    if c ? 'location' then perform ai_private.strict_text(c->'location',200);end if;
  else raise exception 'ai_invalid_proposal';end if;
  perform ai_private.strict_text(c->'title',200);
  if coalesce(c->>'timeZone','') not in ('local','UTC') or c::text ~* '(https?://|www\.|file://)' then raise exception 'ai_invalid_proposal';end if;
end $$;

alter function ai_private.scoped_source_fingerprint(text,uuid) rename to scoped_source_fingerprint_info;
create function ai_private.scoped_source_fingerprint(kind text,source_id uuid) returns text
language plpgsql security definer set search_path='' as $$ declare p public.school_assessment_predictions;b public.operation_batches;r public.ai_scoped_requests;begin
  if kind='prediction' then
    select * into p from public.school_assessment_predictions where id=source_id and user_id=auth.uid() for update;
    if not found or p.status<>'active' or p.generation_request_id is null then raise exception 'ai_source_unavailable';end if;
    select * into b from public.operation_batches where id=p.generation_batch_id and user_id=auth.uid();
    select * into r from public.ai_scoped_requests where id=p.generation_request_id and user_id=auth.uid();
    if b.status is distinct from 'committed' or b.ai_scoped_request_id is distinct from r.id or r.status is distinct from 'applied'
      or r.capability is distinct from 'schoolAssessmentPrediction.propose' or r.trust_version is distinct from 2
      or not public.ai_school_prediction_fresh(r.id) then raise exception 'ai_source_changed';end if;
    perform ai_private.assert_scoped_review(b.id);
    if not exists(select 1 from public.ai_inference_attempts where scoped_request_id=r.id and user_id=auth.uid() and status='succeeded' and location in ('local','remote_local')) then raise exception 'ai_untrusted_generation';end if;
  end if;
  return ai_private.scoped_source_fingerprint_info(kind,source_id);
end $$;

alter function ai_private.validate_scoped_manifest(text,jsonb) rename to validate_scoped_manifest_info;
create function ai_private.validate_scoped_manifest(capability text,manifest jsonb) returns void
language plpgsql set search_path='' as $$ declare expected text;ref jsonb;begin
  if capability='noteSummary.propose' then expected:='note';
  elsif capability='quickCapture.propose' then expected:='capture';
  elsif ai_private.prediction_conversion_capability(capability) then expected:='prediction';
  else perform ai_private.validate_scoped_manifest_info(capability,manifest);return;end if;
  if jsonb_typeof(manifest) is distinct from 'array' then raise exception 'ai_invalid_source';end if;
  if jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source';end if;
  ref:=manifest->0;perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
  if ref->>'kind' is distinct from expected or jsonb_typeof(ref->'id') is distinct from 'string'
    or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(ref->'fingerprint') is distinct from 'string' or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source';end if;
end $$;

alter function ai_private.validate_scoped_output(text,jsonb,text) rename to validate_scoped_output_info;
create function ai_private.validate_scoped_output(capability text,proposal jsonb,handle text) returns void
language plpgsql set search_path='' as $$ declare expected text;begin
  if capability='noteSummary.propose' then
    expected:='propose_note_summary';perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','summary','keyPoints']);
    perform ai_private.strict_text(proposal->'summary',2000,true);perform ai_private.strict_text_array(proposal->'keyPoints',10,500);
  elsif capability='quickCapture.propose' or ai_private.prediction_conversion_capability(capability) then
    expected:=case when capability='quickCapture.propose' then 'propose_quick_capture' else 'propose_prediction_conversion' end;
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','captured','confidence']);
    perform ai_private.validate_capture_item(proposal->'captured');
    if coalesce(proposal->>'confidence','') not in ('HIGH','MEDIUM','LOW') then raise exception 'ai_invalid_proposal';end if;
    if (capability='predictionTask.propose' and proposal->'captured'->>'entityType'<>'task') or
      (capability='predictionEvent.propose' and proposal->'captured'->>'entityType'<>'calendar_event') then raise exception 'ai_capability_denied';end if;
  elsif capability='noteActionItems.propose' then
    perform ai_private.validate_scoped_output_info(capability,proposal,handle);
    if (proposal->'actionItems')::text ~* '(https?://|www\.|file://)' then raise exception 'ai_invalid_proposal';end if;
    return;
  else perform ai_private.validate_scoped_output_info(capability,proposal,handle);return;end if;
  if proposal->'schema_version' is distinct from '1'::jsonb or proposal->'source_handle' is distinct from to_jsonb(handle)
    or proposal->>'type' is distinct from expected or octet_length(proposal::text)>16384 then raise exception 'ai_invalid_proposal';end if;
end $$;

alter function ai_private.scoped_review_target(public.ai_scoped_requests) rename to scoped_review_target_info;
create function ai_private.scoped_review_target(r public.ai_scoped_requests) returns jsonb
language plpgsql set search_path='' as $$ begin
  if r.capability='noteSummary.propose' then return jsonb_build_object('entity','note','id',r.source_manifest->0->>'id');end if;
  if r.capability='quickCapture.propose' then return jsonb_build_object('entity','task','id',null);end if;
  if ai_private.prediction_conversion_capability(r.capability) then return jsonb_build_object('entity','assessment_prediction','id',r.source_manifest->0->>'id');end if;
  return ai_private.scoped_review_target_info(r);
end $$;

create function public.ai_prepare_note(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$ declare d jsonb;r public.ai_scoped_requests;n public.notes;begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_note');perform ai_private.exact_keys(d,array['capability','note_id','provider','model','time_zone']);
  if coalesce(d->>'capability','') not in ('noteSummary.propose','noteRewrite.propose','noteActionItems.propose') then raise exception 'ai_capability_denied';end if;
  r:=ai_private.new_text_request(d,d->>'capability');
  r.source_manifest:=ai_private.scoped_source_manifest(jsonb_build_array(jsonb_build_object('kind','note','id',d->'note_id')));
  select * into n from public.notes where id=(d->>'note_id')::uuid and user_id=auth.uid();
  if char_length(n.body)>15000 then raise exception 'ai_context_too_large';end if;
  r.source_text:=jsonb_build_object('title',n.title,'body',n.body)::text;return ai_private.save_text_request(r);
end $$;

create function public.ai_prepare_capture(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$ declare d jsonb;r public.ai_scoped_requests;cid uuid;begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_capture');perform ai_private.exact_keys(d,array['text','provider','model','time_zone']);
  perform ai_private.strict_text(d->'text',2000,true);r:=ai_private.new_text_request(d,'quickCapture.propose');
  insert into public.captures(user_id,kind,raw_content) values(auth.uid(),'text',jsonb_build_object('text',d->'text')) returning id into cid;
  r.source_manifest:=ai_private.scoped_source_manifest(jsonb_build_array(jsonb_build_object('kind','capture','id',cid)));
  r.source_text:=jsonb_build_object('text',d->'text','today',r.start_date,'timeZone',r.time_zone)::text;return ai_private.save_text_request(r);
end $$;

create function public.ai_record_note_capture(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$ declare d jsonb;r public.ai_scoped_requests;begin
  d:=ai_private.verify_command(p_message,p_mac,'record_scoped_proposal');
  select * into r from public.ai_scoped_requests where id=(d->>'request_id')::uuid and user_id=auth.uid();
  if not ai_private.mutation_text_capability(r.capability) or r.trust_version is distinct from 2 then raise exception 'ai_capability_denied';end if;
  if not exists(select 1 from public.ai_inference_attempts where scoped_request_id=r.id and user_id=auth.uid() and capability=r.capability and status='dispatching') then raise exception 'ai_transfer_unavailable';end if;
  return public.ai_record_scoped_proposal(p_message,p_mac);
end $$;

create function public.ai_revise_current_mutation(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$ declare d jsonb;cap text;begin
  d:=ai_private.verify_command(p_message,p_mac,'revise_scoped_proposal');
  select r.capability into cap from public.operation_batches b join public.ai_scoped_requests r on r.id=b.ai_scoped_request_id and r.user_id=auth.uid() and r.trust_version=2 where b.id=(d->>'batch_id')::uuid and b.user_id=auth.uid();
  if not (ai_private.mutation_text_capability(cap) or ai_private.prediction_conversion_capability(cap)) then raise exception 'ai_capability_denied';end if;
  return public.ai_revise_scoped_proposal(p_message,p_mac);
end $$;

-- One row across both conversion types; owner-readable, no client writes.
create table public.ai_prediction_conversions(
  prediction_id uuid primary key references public.school_assessment_predictions(id) on delete restrict,
  user_id uuid not null references auth.users(id),
  batch_id uuid not null unique references public.operation_batches(id) on delete restrict,
  -- Immutable result IDs outlive native deletion. The INSERT guard verifies
  -- their owner and domain while the fixed consumer still holds the transaction.
  task_id uuid,
  event_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(task_id,event_id)=1)
);
alter table public.ai_prediction_conversions enable row level security;
revoke all on public.ai_prediction_conversions from public,anon,authenticated;
grant select on public.ai_prediction_conversions to authenticated;
create policy prediction_conversion_owner_read on public.ai_prediction_conversions for select to authenticated using(user_id=(select auth.uid()));

create function public.ai_prediction_conversion_guard() returns trigger
language plpgsql security definer set search_path='' as $$ declare b public.operation_batches;r public.ai_scoped_requests;p public.school_assessment_predictions;begin
  if tg_op<>'INSERT' then raise exception 'ai_immutable_conversion';end if;
  select * into b from public.operation_batches where id=new.batch_id and user_id=new.user_id;
  select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id and user_id=new.user_id;
  select * into p from public.school_assessment_predictions where id=new.prediction_id and user_id=new.user_id;
  if b.status is distinct from 'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id() or r.trust_version is distinct from 2
    or p.status is distinct from 'active' or r.source_manifest->0->>'id' is distinct from new.prediction_id::text
    or (new.task_id is not null and (r.capability<>'predictionTask.propose' or not exists(select 1 from public.tasks where id=new.task_id and user_id=new.user_id and course_id=p.course_id)))
    or (new.event_id is not null and (r.capability<>'predictionEvent.propose' or not exists(select 1 from public.calendar_events where id=new.event_id and user_id=new.user_id and source='life_os')))
    then raise exception 'ai_untrusted_conversion';end if;
  return new;
end $$;
create trigger ai_prediction_conversion_guard before insert or update or delete on public.ai_prediction_conversions for each row execute function public.ai_prediction_conversion_guard();

create or replace function public.school_prediction_state_guard() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if tg_op='INSERT' then if new.status<>'active' then raise exception 'prediction_must_start_active';end if;return new;end if;
  if new.status is not distinct from old.status then return new;end if;
  if old.status<>'active' then raise exception 'prediction_terminal_state';end if;
  if new.status in ('dismissed','superseded') then return new;end if;
  if new.status='confirmed' and exists(select 1 from public.ai_prediction_conversions c join public.operation_batches b on b.id=c.batch_id
    where c.prediction_id=old.id and c.user_id=old.user_id and b.user_id=old.user_id and b.status='confirmed' and b.ai_apply_xid=pg_current_xact_id()) then return new;end if;
  raise exception 'prediction_confirmation_requires_review';
end $$;

create function public.ai_prepare_prediction_conversion(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$ declare d jsonb;r public.ai_scoped_requests;p public.school_assessment_predictions;c jsonb;b uuid;w timestamp;begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_prediction_conversion');perform ai_private.exact_keys(d,array['prediction_id','kind','time_zone']);
  if coalesce(d->>'kind','') not in ('task','calendar_event') then raise exception 'ai_capability_denied';end if;
  r:=ai_private.new_text_request(d||jsonb_build_object('provider','ollama','model','canonical-review'),case when d->>'kind'='task' then 'predictionTask.propose' else 'predictionEvent.propose' end);
  r.provider:='server_parser';r.model:='prediction-review-v1';
  r.source_manifest:=ai_private.scoped_source_manifest(jsonb_build_array(jsonb_build_object('kind','prediction','id',d->'prediction_id')));
  select * into p from public.school_assessment_predictions where id=(d->>'prediction_id')::uuid and user_id=auth.uid();
  r.source_text:=jsonb_build_object('title',p.title,'date',p.predicted_date,'time',p.predicted_time,'generationRequest',p.generation_request_id)::text;
  if d->>'kind'='task' then
    c:=jsonb_build_object('entityType','task','title',p.title,'dueDate',p.predicted_date,'timeZone','local');
    if p.predicted_time is not null then c:=c||jsonb_build_object('dueTime',p.predicted_time);end if;
  elsif p.predicted_time is null then
    c:=jsonb_build_object('entityType','calendar_event','title',p.title,'startDate',p.predicted_date,'endDate',p.predicted_date+1,'allDay',true,'timeZone','local');
  else
    w:=p.predicted_date+p.predicted_time::time+interval '1 hour';
    c:=jsonb_build_object('entityType','calendar_event','title',p.title,'startDate',p.predicted_date,'startTime',p.predicted_time,'endDate',w::date,'endTime',to_char(w,'HH24:MI'),'allDay',false,'timeZone','local');
  end if;
  perform ai_private.save_text_request(r);select * into r from public.ai_scoped_requests where id=r.id;
  b:=ai_private.insert_scoped_review(r,jsonb_build_object('schema_version',1,'type','propose_prediction_conversion','source_handle',r.source_handle,'captured',c,'confidence',p.confidence),null);
  update public.ai_scoped_requests set status='proposed' where id=r.id;return b;
end $$;

-- Domain constructors are private, fixed INSERTs. They cannot update/delete or
-- interpret a model operation, and derive all owner/course authority in SQL.
create function ai_private.insert_reviewed_task(c jsonb,z text,course_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$ declare tid uuid;due timestamptz;local_day date;begin
  perform ai_private.validate_capture_item(c);if c->>'entityType'<>'task' then raise exception 'ai_capability_denied';end if;
  if c ? 'dueTime' then due:=ai_private.wall_instant(ai_private.strict_day(c->'dueDate'),ai_private.strict_clock(c->'dueTime'),case when c->>'timeZone'='UTC' then 'UTC' else z end);end if;
  local_day:=case when due is not null then (due at time zone z)::date when c ? 'dueDate' then ai_private.strict_day(c->'dueDate') else null end;
  insert into public.tasks(user_id,title,status,priority,due_date,due_at,course_id)
    values(auth.uid(),c->>'title','inbox',coalesce(c->>'priority','none')::public.task_priority,local_day,due,course_id) returning id into tid;return tid;
end $$;
create function ai_private.insert_reviewed_event(c jsonb,z text,course_label text default null) returns uuid
language plpgsql security definer set search_path='' as $$ declare eid uuid;lo timestamptz;hi timestamptz;begin
  perform ai_private.validate_capture_item(c);if c->>'entityType'<>'calendar_event' then raise exception 'ai_capability_denied';end if;
  lo:=ai_private.wall_instant(ai_private.strict_day(c->'startDate'),case when (c->>'allDay')::boolean then '00:00'::time else ai_private.strict_clock(c->'startTime') end,case when c->>'timeZone'='UTC' then 'UTC' else z end);
  hi:=ai_private.wall_instant(ai_private.strict_day(c->'endDate'),case when (c->>'allDay')::boolean then '00:00'::time else ai_private.strict_clock(c->'endTime') end,case when c->>'timeZone'='UTC' then 'UTC' else z end);
  if hi<=lo then raise exception 'ai_invalid_proposal';end if;
  insert into public.calendar_events(user_id,title,description,starts_at,ends_at,all_day,event_type,source,course)
    values(auth.uid(),c->>'title',case when c ? 'location' then 'Location: '||(c->>'location') else null end,lo,hi,(c->>'allDay')::boolean,'event','life_os',course_label) returning id into eid;return eid;
end $$;

alter function ai_private.finish_scoped_apply(uuid,jsonb) rename to finish_scoped_apply_pass2;
create function ai_private.finish_scoped_apply(batch_id uuid,result jsonb) returns void
language plpgsql security definer set search_path='' as $$ declare b public.operation_batches;r public.ai_scoped_requests;a jsonb;begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid() for update;
  select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id and user_id=auth.uid();
  if not (r.capability in ('noteSummary.propose','quickCapture.propose') or ai_private.prediction_conversion_capability(r.capability)) then perform ai_private.finish_scoped_apply_pass2(batch_id,result);return;end if;
  if b.status is distinct from 'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id() or r.status is distinct from 'proposed' or r.expires_at<=clock_timestamp() then raise exception 'ai_consumption_unavailable';end if;
  a:=ai_private.assert_scoped_review(b.id);perform ai_private.exact_keys(result,array['entity','ids']);
  if jsonb_typeof(result->'ids') is distinct from 'array' then raise exception 'ai_invalid_result';end if;
  if jsonb_array_length(result->'ids')<>1 then raise exception 'ai_invalid_result';end if;
  if r.capability='noteSummary.propose' then
    if result->>'entity' is distinct from 'note' or result->'ids' is distinct from jsonb_build_array(r.source_manifest->0->>'id') then raise exception 'ai_invalid_result';end if;
  elsif a->'proposal'->'captured'->>'entityType'='task' then
    if result->>'entity' is distinct from 'task' or not exists(select 1 from public.tasks where id=(result->'ids'->>0)::uuid and user_id=auth.uid()) then raise exception 'ai_invalid_result';end if;
  else
    if result->>'entity' is distinct from 'event' or not exists(select 1 from public.calendar_events where id=(result->'ids'->>0)::uuid and user_id=auth.uid()) then raise exception 'ai_invalid_result';end if;
  end if;
  if ai_private.prediction_conversion_capability(r.capability) and not exists(select 1 from public.ai_prediction_conversions c join public.school_assessment_predictions p on p.id=c.prediction_id
    where c.batch_id=b.id and c.user_id=auth.uid() and p.status='confirmed' and coalesce(c.task_id,c.event_id)::text=result->'ids'->>0) then raise exception 'ai_invalid_result';end if;
  update public.operation_steps set inverse=jsonb_build_object('result',result,'review_digest',b.ai_review_digest,'source_manifest',r.source_manifest,'provider',r.provider,'model',r.model,'evidence',case when r.provider in ('gemini','openrouter') then 'server_response' when r.provider='server_parser' then 'canonical_prediction' else 'browser_relay' end,'undo_supported',false) where operation_steps.batch_id=b.id and position=0;
  update public.operation_batches set status='committed',committed_at=clock_timestamp() where id=b.id;update public.ai_scoped_requests set status='applied' where id=r.id;
end $$;

create function ai_private.require_completed_text_inference(a jsonb) returns void
language plpgsql security definer set search_path='' as $$ begin
  if not exists(select 1 from public.ai_inference_attempts where scoped_request_id=(a->>'request_id')::uuid and user_id=auth.uid() and capability=a->>'capability' and status='succeeded') then raise exception 'ai_transfer_unavailable';end if;
end $$;

create function public.ai_apply_note_summary(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;nid uuid;new_body text;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'noteSummary.propose');perform ai_private.require_completed_text_inference(a);nid:=(a->'source_manifest'->0->>'id')::uuid;
  select n.body||E'\n\n## Summary\n\n'||(a->'proposal'->>'summary')||coalesce((select E'\n\n'||string_agg('- '||value,E'\n') from jsonb_array_elements_text(a->'proposal'->'keyPoints')), '') into new_body from public.notes n where id=nid and user_id=auth.uid();
  if char_length(new_body)>100000 then raise exception 'ai_context_too_large';end if;
  update public.notes set body=new_body where id=nid and user_id=auth.uid();
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','note','ids',jsonb_build_array(nid)));return jsonb_build_object('ok',true,'noteId',nid);
end $$;
create function public.ai_apply_note_rewrite(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;nid uuid;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'noteRewrite.propose');perform ai_private.require_completed_text_inference(a);nid:=(a->'source_manifest'->0->>'id')::uuid;
  update public.notes set body=a->'proposal'->>'rewrittenBody',title=coalesce(a->'proposal'->>'rewrittenTitle',title) where id=nid and user_id=auth.uid();
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','note','ids',jsonb_build_array(nid)));return jsonb_build_object('ok',true,'noteId',nid);
end $$;
create function public.ai_apply_note_tasks(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;x jsonb;ids jsonb:='[]';tid uuid;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'noteActionItems.propose');perform ai_private.require_completed_text_inference(a);
  for x in select * from jsonb_array_elements(a->'proposal'->'actionItems') loop
    insert into public.tasks(user_id,title,status,priority,due_date) values(auth.uid(),x->>'title','inbox',coalesce(x->>'priority','none')::public.task_priority,(x->>'dueDate')::date) returning id into tid;
    ids:=ids||jsonb_build_array(tid);
  end loop;
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','task','ids',ids));return jsonb_build_object('ok',true,'taskIds',ids);
end $$;

-- Explicit fixed consumers for Task/Event; never dynamic SQL.

create function public.ai_apply_capture_task(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;r public.ai_scoped_requests;pid uuid;course_id uuid;course_label text;created_id uuid;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'quickCapture.propose');
  select * into r from public.ai_scoped_requests where id=(a->>'request_id')::uuid and user_id=auth.uid();
  perform ai_private.require_completed_text_inference(a);
  created_id:=ai_private.insert_reviewed_task(a->'proposal'->'captured',r.time_zone,course_id);
  update public.captures set stage='committed' where id=(a->'source_manifest'->0->>'id')::uuid and user_id=auth.uid();
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','task','ids',jsonb_build_array(created_id)));
  return jsonb_build_object('ok',true,'taskId',created_id);
end $$;

create function public.ai_apply_capture_event(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;r public.ai_scoped_requests;pid uuid;course_id uuid;course_label text;created_id uuid;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'quickCapture.propose');
  select * into r from public.ai_scoped_requests where id=(a->>'request_id')::uuid and user_id=auth.uid();
  perform ai_private.require_completed_text_inference(a);
  created_id:=ai_private.insert_reviewed_event(a->'proposal'->'captured',r.time_zone,course_label);
  update public.captures set stage='committed' where id=(a->'source_manifest'->0->>'id')::uuid and user_id=auth.uid();
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','event','ids',jsonb_build_array(created_id)));
  return jsonb_build_object('ok',true,'eventId',created_id);
end $$;

create function public.ai_apply_prediction_task(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;r public.ai_scoped_requests;pid uuid;course_id uuid;course_label text;created_id uuid;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'predictionTask.propose');
  select * into r from public.ai_scoped_requests where id=(a->>'request_id')::uuid and user_id=auth.uid();
  pid:=(a->'source_manifest'->0->>'id')::uuid;
  select p.course_id,c.code||' '||c.name into course_id,course_label from public.school_assessment_predictions p join public.courses c on c.id=p.course_id and c.user_id=auth.uid() where p.id=pid and p.user_id=auth.uid() and p.status='active';
  if not found then raise exception 'ai_source_changed';end if;
  created_id:=ai_private.insert_reviewed_task(a->'proposal'->'captured',r.time_zone,course_id);
  insert into public.ai_prediction_conversions(prediction_id,user_id,batch_id,task_id) values(pid,auth.uid(),(a->>'batch_id')::uuid,created_id);
  update public.school_assessment_predictions set status='confirmed' where id=pid and user_id=auth.uid() and status='active';
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','task','ids',jsonb_build_array(created_id)));
  return jsonb_build_object('ok',true,'taskId',created_id);
end $$;

create function public.ai_apply_prediction_event(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$ declare a jsonb;r public.ai_scoped_requests;pid uuid;course_id uuid;course_label text;created_id uuid;begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'predictionEvent.propose');
  select * into r from public.ai_scoped_requests where id=(a->>'request_id')::uuid and user_id=auth.uid();
  pid:=(a->'source_manifest'->0->>'id')::uuid;
  select p.course_id,c.code||' '||c.name into course_id,course_label from public.school_assessment_predictions p join public.courses c on c.id=p.course_id and c.user_id=auth.uid() where p.id=pid and p.user_id=auth.uid() and p.status='active';
  if not found then raise exception 'ai_source_changed';end if;
  created_id:=ai_private.insert_reviewed_event(a->'proposal'->'captured',r.time_zone,course_label);
  insert into public.ai_prediction_conversions(prediction_id,user_id,batch_id,event_id) values(pid,auth.uid(),(a->>'batch_id')::uuid,created_id);
  update public.school_assessment_predictions set status='confirmed' where id=pid and user_id=auth.uid() and status='active';
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','event','ids',jsonb_build_array(created_id)));
  return jsonb_build_object('ok',true,'eventId',created_id);
end $$;

alter function ai_private.inference_source(uuid,uuid,uuid) rename to inference_source_info;
create function ai_private.inference_source(p_checklist uuid,p_course uuid,p_scoped uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$ declare r public.ai_scoped_requests;begin
  if p_scoped is not null then select * into r from public.ai_scoped_requests where id=p_scoped and user_id=auth.uid();end if;
  if ai_private.mutation_text_capability(r.capability) then
    if num_nonnulls(p_checklist,p_course,p_scoped)<>1 then raise exception 'ai_capability_denied';end if;
    r:=ai_private.lock_scoped_request(p_scoped);if r.status<>'prepared' then raise exception 'ai_request_unavailable';end if;return r.expires_at;
  end if;
  return ai_private.inference_source_info(p_checklist,p_course,p_scoped);
end $$;

create or replace function public.ai_school_prediction_attempt_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare q public.ai_scoped_requests;x jsonb;r public.academic_calendar_source_revisions;
begin
  if new.scoped_request_id is null then return new;end if;select * into q from public.ai_scoped_requests where id=new.scoped_request_id and user_id=new.user_id;
  if q.trust_version is null then return new;end if;
  if q.trust_version<>2 or new.capability is distinct from q.capability or new.provider is distinct from q.provider or new.model is distinct from q.model or new.parent_id is not null then raise exception 'ai_capability_denied';end if;
  if q.capability='schoolAssessmentPrediction.propose' then if new.location not in ('local','remote_local') then raise exception 'ai_capability_denied';end if;
  elsif q.capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then
    x:=q.source_text::jsonb;if new.location is distinct from x->>'location' or not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=new.user_id and d.capability=q.capability and d.provider=new.provider and d.model=new.model and d.location=new.location) then raise exception 'ai_capability_denied';end if;
  elsif q.capability='academicCalendarImport.propose' then
    select * into r from public.academic_calendar_source_revisions where id=(q.source_manifest->0->>'id')::uuid and user_id=new.user_id;
    x:=q.source_text::jsonb;
    if r.format in ('ics','csv') or new.location is distinct from x->>'location' then raise exception 'ai_capability_denied';end if;
    if r.format in ('png','jpeg','webp') and not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=new.user_id
      and d.image_id=r.image_id and d.capability=q.capability and d.provider=new.provider and d.model=new.model and d.location=new.location) then raise exception 'ai_capability_denied';end if;
  elsif ai_private.informational_capability(q.capability) or ai_private.mutation_text_capability(q.capability) then
    if (new.provider in ('gemini','openrouter')) is distinct from (new.location='cloud') then raise exception 'ai_capability_denied';end if;
  else raise exception 'ai_capability_denied';end if;return new;
end $$;

create or replace function ai_private.cloud_allowed(p_capability text,p_provider text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select p_provider in ('gemini','openrouter') and cloud_enabled and cloud_fallback_mode<>'off'
    and (ai_mode=p_provider or (ai_mode='auto' and (preferred_cloud=p_provider or secondary_cloud))) and
    case p_capability when 'taskChecklist.propose' then checklist_cloud when 'courseImport.propose' then course_import_cloud
      when 'schoolScheduleImage.propose' then school_schedule_cloud and cloud_fallback_mode='ask_each_time'
      when 'blackboardCourseImage.propose' then blackboard_course_cloud and cloud_fallback_mode='ask_each_time'
      when 'academicCalendarImport.propose' then academic_calendar_cloud and cloud_fallback_mode='ask_each_time'
      when 'dailyPlanAdvice.propose' then daily_plan_cloud
      when 'courseMaterialSummary.propose' then course_material_cloud when 'courseMaterialStudyQuestions.propose' then course_material_cloud
      when 'contextualAssistant.propose' then contextual_assistant_cloud
      when 'noteSummary.propose' then notes_cloud when 'noteRewrite.propose' then notes_cloud when 'noteActionItems.propose' then notes_cloud
      when 'quickCapture.propose' then quick_capture_cloud
      else false end from public.ai_preferences where user_id=auth.uid()),false)
$$;

create or replace function ai_private.finish_scoped_apply_pass2c(batch_id uuid,result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches; r public.ai_scoped_requests; authority jsonb;
begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid() for update;
  if not found or b.status<>'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id() then raise exception 'ai_consumption_unavailable'; end if;
  authority:=ai_private.assert_scoped_review(b.id); select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id;
  if r.status<>'proposed' or r.expires_at<=clock_timestamp() then raise exception 'ai_request_unavailable'; end if;
  perform ai_private.exact_keys(result,array['entity','ids']);
  if jsonb_typeof(result->'ids') is distinct from 'array' or octet_length(result::text)>4096 then raise exception 'ai_invalid_result'; end if;
  if r.capability='noteRewrite.propose' then if result->>'entity' is distinct from 'note' or result->'ids' is distinct from jsonb_build_array(r.source_manifest->0->>'id') then raise exception 'ai_invalid_result'; end if;
  elsif r.capability='noteActionItems.propose' then
    if result->>'entity' is distinct from 'task' or jsonb_array_length(result->'ids')<>jsonb_array_length(authority->'proposal'->'actionItems')
      or (select count(distinct id) from public.tasks where user_id=auth.uid() and id in(select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result'; end if;
  elsif r.capability='schoolAssessmentPrediction.propose' then
    if result->>'entity' is distinct from 'assessment_prediction' or jsonb_array_length(result->'ids')<>jsonb_array_length(authority->'proposal'->'predictions')
      or (select count(*) from public.school_assessment_predictions p where p.user_id=auth.uid() and p.generation_batch_id=b.id and p.id in(select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result'; end if;
  elsif r.capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then
    if result->>'entity' is distinct from 'course_import' or (select count(distinct value) from jsonb_array_elements_text(result->'ids'))<>jsonb_array_length(result->'ids')
      or (select count(*) from public.courses c where c.user_id=auth.uid() and c.id in(select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result'; end if;
  else raise exception 'ai_capability_denied'; end if;
  update public.operation_steps set inverse=jsonb_build_object('result',result,'review_digest',b.ai_review_digest,'source_manifest',r.source_manifest,'provider',r.provider,'model',r.model,'evidence',case when r.provider in ('gemini','openrouter') then 'server_response' else 'browser_relay' end,'undo_supported',false) where operation_steps.batch_id=b.id and position=0;
  update public.operation_batches set status='committed',committed_at=clock_timestamp() where id=b.id; update public.ai_scoped_requests set status='applied' where id=r.id;
end $$;


create or replace function public.ai_read_scoped_review(p_batch_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('batchId',b.id,'status',b.status,'input',s.input,
    'proposalDigest',encode(sha256(convert_to(s.input::text,'UTF8')),'hex'),
    'reviewDigest',b.ai_review_digest,'predecessorBatchId',b.ai_predecessor_batch_id,
    'trustVersion',r.trust_version,'sourceManifest',r.source_manifest,'expiresAt',r.expires_at,
    'sourceHandle',r.source_handle,'capability',r.capability,'fileName',r.file_name,
    'startDate',r.start_date,'timeZone',r.time_zone,'provenance',case when r.trust_version=2 then
      coalesce(public.ai_read_inference_provenance(b.id),jsonb_build_object('provider',r.provider,'model',r.model,'evidence',case when r.provider in ('gemini','openrouter') then 'server_response' when r.provider='server_parser' then 'canonical_prediction' else 'browser_relay' end)) else public.ai_read_inference_provenance(b.id) end)
  from public.operation_batches b join public.ai_scoped_requests r on r.id=b.ai_scoped_request_id and r.user_id=auth.uid()
    join public.operation_steps s on s.batch_id=b.id and s.user_id=auth.uid() and s.position=0
  where b.id=p_batch_id and b.user_id=auth.uid() and b.source='ai'
$$;


revoke all on function ai_private.mutation_text_capability(text),
  ai_private.prediction_conversion_capability(text),
  ai_private.strict_day(jsonb),
  ai_private.strict_clock(jsonb),
  ai_private.wall_instant(date,time,text),
  ai_private.validate_capture_item(jsonb),
  ai_private.scoped_source_fingerprint(text,uuid),
  ai_private.validate_scoped_manifest(text,jsonb),
  ai_private.validate_scoped_output(text,jsonb,text),
  ai_private.scoped_review_target(public.ai_scoped_requests),
  public.ai_prepare_note(text,text),
  public.ai_prepare_capture(text,text),
  public.ai_record_note_capture(text,text),
  public.ai_revise_current_mutation(text,text),
  public.ai_prediction_conversion_guard(),
  public.ai_prepare_prediction_conversion(text,text),
  ai_private.insert_reviewed_task(jsonb,text,uuid),
  ai_private.insert_reviewed_event(jsonb,text,text),
  ai_private.finish_scoped_apply(uuid,jsonb),
  ai_private.require_completed_text_inference(jsonb),
  public.ai_apply_note_summary(text,text),
  public.ai_apply_note_rewrite(text,text),
  public.ai_apply_note_tasks(text,text),
  public.ai_apply_capture_task(text,text),
  public.ai_apply_capture_event(text,text),
  public.ai_apply_prediction_task(text,text),
  public.ai_apply_prediction_event(text,text),
  ai_private.inference_source(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_prepare_note(text,text),
  public.ai_prepare_capture(text,text),
  public.ai_record_note_capture(text,text),
  public.ai_revise_current_mutation(text,text),
  public.ai_prepare_prediction_conversion(text,text),
  public.ai_apply_note_summary(text,text),
  public.ai_apply_note_rewrite(text,text),
  public.ai_apply_note_tasks(text,text),
  public.ai_apply_capture_task(text,text),
  public.ai_apply_capture_event(text,text),
  public.ai_apply_prediction_task(text,text),
  public.ai_apply_prediction_event(text,text) to authenticated;

create or replace function public.enforce_capture_stage_transition() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- AI capture evidence is consumed only by a sealed review claimed in this transaction.
  if old.stage = 'captured' and new.stage = 'committed' and new.user_id = auth.uid() and exists (
    select 1 from public.operation_batches b join public.ai_scoped_requests r on r.id = b.ai_scoped_request_id
    where b.user_id = auth.uid() and r.user_id = auth.uid() and r.trust_version = 2
      and r.capability = 'quickCapture.propose' and b.status = 'confirmed'
      and b.ai_apply_xid = pg_current_xact_id()
      and r.source_manifest->0->>'id' = new.id::text
      and r.source_manifest->0->>'kind' = 'capture'
  ) then return new; end if;
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
revoke all on function public.enforce_capture_stage_transition() from public,anon,authenticated;
