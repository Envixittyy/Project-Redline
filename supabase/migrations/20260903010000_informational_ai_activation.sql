-- Additive activation through the existing Pass-1 request/review authority.
-- Generic public prepare/record/revise/Apply grants remain revoked.
create function ai_private.informational_capability(cap text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(cap in ('dailyPlanAdvice.propose','courseMaterialSummary.propose','courseMaterialStudyQuestions.propose','contextualAssistant.propose'),false)
$$;

-- A bounded snapshot for the day's informational read. IDs remain private and
-- are removed before context leaves SQL. A single SQL statement captures each
-- collection, including empty sets and newly inserted rows, in one MVCC snapshot.
create function ai_private.daily_state() returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare s jsonb; a jsonb;
begin
  if auth.uid() is null then raise exception 'ai_authorization_denied';end if;
  select jsonb_build_object(
    'tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from
      (select id,title,status,priority,due_date,due_at,scheduled_start,scheduled_end from public.tasks where user_id=auth.uid() and status in ('inbox','todo','in_progress') order by id limit 101)t),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from
      (select id,title,starts_at,ends_at,all_day,source from public.calendar_events where user_id=auth.uid() and ends_at>current_date-2 and starts_at<current_date+2 order by id limit 101)e),
    'sessions',(select coalesce(jsonb_agg(to_jsonb(w) order by w.id),'[]') from
      (select w.id,t.title,w.starts_at,w.ends_at from public.task_work_sessions w join public.tasks t on t.id=w.task_id and t.user_id=auth.uid()
       where w.user_id=auth.uid() and w.status<>'cancelled' and w.ends_at>current_date-2 and w.starts_at<current_date+2 order by w.id limit 101)w),
    'classes',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from
      (select m.id,c.code,c.name,m.weekdays,m.start_date,m.end_date_exclusive,m.start_time,m.end_time,m.time_zone
       from public.course_meetings m join public.courses c on c.id=m.course_id and c.user_id=auth.uid() and c.archived_at is null
       where m.user_id=auth.uid() order by m.id limit 101)m),
    'external',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from
      (select e.id,e.title,e.starts_at,e.ends_at,e.all_day,a.provider as source from public.external_calendar_events e
       join public.external_calendars c on c.id=e.calendar_id and c.user_id=auth.uid() and c.selected
       join public.external_calendar_accounts a on a.id=c.account_id and a.user_id=auth.uid() and a.status='connected'
       where e.user_id=auth.uid() and e.missing_since is null and e.status<>'cancelled' and e.ends_at>current_date-2 and e.starts_at<current_date+2 order by e.id limit 101)e)
  ) into s;
  for a in select value from jsonb_each(s) loop
    if jsonb_array_length(a)>100 then raise exception 'ai_context_too_large';end if;
  end loop;
  if octet_length(s::text)>131072 then raise exception 'ai_context_too_large';end if;
  return s;
end $$;

alter function ai_private.scoped_source_fingerprint(text,uuid) rename to scoped_source_fingerprint_pass2;
create function ai_private.scoped_source_fingerprint(kind text,source_id uuid) returns text
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare s jsonb;
begin
  if kind='daily_plan' then
    if source_id is distinct from auth.uid() then raise exception 'ai_source_unavailable';end if;
    s:=ai_private.daily_state();
  elsif kind='context_task' then
    select jsonb_build_object('entityType','task','title',title,'body',coalesce(description,''),'dueDate',due_date,'priority',priority,'status',status)
      into s from public.tasks where id=source_id and user_id=auth.uid() for update;
  elsif kind='context_course' then
    select jsonb_build_object('entityType','course','code',code,'name',name,'instructor',instructor,'location',location)
      into s from public.courses where id=source_id and user_id=auth.uid() and archived_at is null for update;
  else return ai_private.scoped_source_fingerprint_pass2(kind,source_id);
  end if;
  if s is null then raise exception 'ai_source_unavailable';end if;
  return ai_private.scoped_hash(jsonb_build_array(1,auth.uid(),kind,s));
end $$;

alter function ai_private.validate_scoped_manifest(text,jsonb) rename to validate_scoped_manifest_pass2;
create function ai_private.validate_scoped_manifest(capability text,manifest jsonb) returns void
language plpgsql set search_path='' as $$
declare ref jsonb;
begin
  if not ai_private.informational_capability(capability) then perform ai_private.validate_scoped_manifest_pass2(capability,manifest);return;end if;
  if jsonb_typeof(manifest) is distinct from 'array' then raise exception 'ai_invalid_source';end if;
  if capability in ('courseMaterialSummary.propose','courseMaterialStudyQuestions.propose') then
    if jsonb_array_length(manifest) not between 1 and 3 then raise exception 'ai_invalid_source';end if;
  elsif jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source';end if;
  for ref in select * from jsonb_array_elements(manifest) loop
    perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
    if jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(ref->'fingerprint') is distinct from 'string' or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source';end if;
    if (capability='dailyPlanAdvice.propose' and ref->>'kind' is distinct from 'daily_plan')
      or (capability in ('courseMaterialSummary.propose','courseMaterialStudyQuestions.propose') and ref->>'kind' is distinct from 'course_material')
      or (capability='contextualAssistant.propose' and coalesce(ref->>'kind','') not in ('note','context_task','context_course','course_material')) then raise exception 'ai_invalid_source';end if;
  end loop;
end $$;

create function ai_private.strict_text_array(a jsonb,max_items integer,max_chars integer) returns void
language plpgsql set search_path='' as $$ declare x jsonb; begin
  if jsonb_typeof(a) is distinct from 'array' then raise exception 'ai_invalid_proposal';end if;
  if jsonb_array_length(a)>max_items then raise exception 'ai_invalid_proposal';end if;
  for x in select * from jsonb_array_elements(a) loop perform ai_private.strict_text(x,max_chars,true);end loop;
end $$;

alter function ai_private.validate_scoped_output(text,jsonb,text) rename to validate_scoped_output_pass2;
create function ai_private.validate_scoped_output(capability text,proposal jsonb,handle text) returns void
language plpgsql set search_path='' as $$ declare x jsonb; expected text; begin
  if not ai_private.informational_capability(capability) then perform ai_private.validate_scoped_output_pass2(capability,proposal,handle);return;end if;
  if capability='dailyPlanAdvice.propose' then
    expected:='propose_daily_plan_advice';
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','workloadExplanation','prioritizationSuggestions','scheduleRationale']);
    perform ai_private.strict_text(proposal->'workloadExplanation',1500,true);perform ai_private.strict_text(proposal->'scheduleRationale',1500,true);
    perform ai_private.strict_text_array(proposal->'prioritizationSuggestions',6,300);
    if octet_length(proposal::text)>16384 then raise exception 'ai_invalid_proposal';end if;
  elsif capability='courseMaterialSummary.propose' then
    expected:='propose_course_material_summary';
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','overview','keyConcepts','practicalTakeaways']);
    perform ai_private.strict_text(proposal->'overview',3000,true);perform ai_private.strict_text_array(proposal->'practicalTakeaways',10,300);
    if jsonb_typeof(proposal->'keyConcepts') is distinct from 'array' then raise exception 'ai_invalid_proposal';end if;
    if jsonb_array_length(proposal->'keyConcepts')>15 then raise exception 'ai_invalid_proposal';end if;
    for x in select * from jsonb_array_elements(proposal->'keyConcepts') loop
      perform ai_private.exact_keys(x,array['term','definition']);perform ai_private.strict_text(x->'term',100);perform ai_private.strict_text(x->'definition',500,true);
    end loop;
  elsif capability='courseMaterialStudyQuestions.propose' then
    expected:='propose_course_material_study_questions';
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','questions']);
    if jsonb_typeof(proposal->'questions') is distinct from 'array' then raise exception 'ai_invalid_proposal';end if;
    if jsonb_array_length(proposal->'questions') not between 1 and 15 then raise exception 'ai_invalid_proposal';end if;
    for x in select * from jsonb_array_elements(proposal->'questions') loop
      perform ai_private.exact_keys(x,array['question','answer'],array['conceptTag','difficulty']);
      perform ai_private.strict_text(x->'question',300,true);perform ai_private.strict_text(x->'answer',1000,true);
      if x ? 'conceptTag' then perform ai_private.strict_text(x->'conceptTag',50);end if;
      if x ? 'difficulty' and coalesce(x->>'difficulty','') not in ('easy','medium','hard') then raise exception 'ai_invalid_proposal';end if;
    end loop;
  else
    expected:='propose_contextual_assistance';
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','answer','keyCitations'],array['suggestedFollowUps']);
    perform ai_private.strict_text(proposal->'answer',4000,true);perform ai_private.strict_text_array(proposal->'keyCitations',5,300);
    if proposal ? 'suggestedFollowUps' then perform ai_private.strict_text_array(proposal->'suggestedFollowUps',3,150);end if;
  end if;
  if proposal->'schema_version' is distinct from '1'::jsonb or proposal->'source_handle' is distinct from to_jsonb(handle)
    or proposal->>'type' is distinct from expected or octet_length(proposal::text)>32768 then raise exception 'ai_invalid_proposal';end if;
end $$;

alter function ai_private.scoped_review_target(public.ai_scoped_requests) rename to scoped_review_target_pass2;
create function ai_private.scoped_review_target(r public.ai_scoped_requests) returns jsonb
language plpgsql set search_path='' as $$ begin
  if ai_private.informational_capability(r.capability) then
    return jsonb_build_object('entity',case when r.capability='dailyPlanAdvice.propose' then 'daily_plan' when r.capability='contextualAssistant.propose' then 'contextual_assistant' else 'course_material' end,'id',r.source_manifest->0->>'id');
  end if;
  return ai_private.scoped_review_target_pass2(r);
end $$;

-- Internal initialization is not a grant. Product preparation always constructs
-- the canonical source and chooses its own registered capability.
create function ai_private.new_text_request(d jsonb,cap text) returns public.ai_scoped_requests
language plpgsql security definer set search_path='' as $$ declare r public.ai_scoped_requests;begin
  if auth.uid() is null then raise exception 'ai_authorization_denied';end if;
  if jsonb_typeof(d->'provider') is distinct from 'string' or d->>'provider' not in ('ollama','llamacpp','openai_compatible','gemini','openrouter')
    or jsonb_typeof(d->'model') is distinct from 'string' or d->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    or jsonb_typeof(d->'time_zone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'time_zone') then raise exception 'ai_invalid_source';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  if (select count(*) from public.ai_scoped_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'ai_rate_limited';end if;
  r.id:=gen_random_uuid();r.user_id:=auth.uid();r.capability:=cap;r.source_handle:='source_'||replace(gen_random_uuid()::text,'-','');
  r.provider:=d->>'provider';r.model:=d->>'model';r.time_zone:=d->>'time_zone';r.created_at:=clock_timestamp();r.expires_at:=r.created_at+interval '5 minutes';
  r.start_date:=(r.created_at at time zone r.time_zone)::date;r.status:='prepared';r.trust_version:=2;return r;
end $$;

create function ai_private.save_text_request(r public.ai_scoped_requests) returns uuid
language plpgsql security definer set search_path='' as $$ begin
  perform ai_private.validate_scoped_manifest(r.capability,r.source_manifest);
  if r.user_id is distinct from auth.uid() or r.source_text is null or octet_length(r.source_text)>24000 then raise exception 'ai_context_too_large';end if;
  r.source_digest:=encode(sha256(convert_to(r.source_text,'UTF8')),'hex');r.authority_digest:=ai_private.scoped_request_digest(r);
  insert into public.ai_scoped_requests select (r).*;return r.id;
end $$;

create function public.ai_prepare_informational(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare d jsonb;r public.ai_scoped_requests;s jsonb;x jsonb;items jsonb;events jsonb:='[]';tasks jsonb;meeting_day date;lo timestamptz;hi timestamptz;start_at timestamptz;end_at timestamptz;kind text;selected_id uuid;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_informational');
  perform ai_private.exact_keys(d,array['capability','selection','question','provider','model','time_zone']);
  if not ai_private.informational_capability(d->>'capability') then raise exception 'ai_capability_denied';end if;
  r:=ai_private.new_text_request(d,d->>'capability');
  if r.capability='dailyPlanAdvice.propose' then
    if d->'selection' is distinct from '[]'::jsonb or d->'question' is distinct from 'null'::jsonb then raise exception 'ai_invalid_source';end if;
    s:=ai_private.daily_state();
    r.source_manifest:=jsonb_build_array(jsonb_build_object('kind','daily_plan','id',auth.uid(),'fingerprint',ai_private.scoped_hash(jsonb_build_array(1,auth.uid(),'daily_plan',s))));
    lo:=r.start_date::timestamp at time zone r.time_zone;hi:=(r.start_date+1)::timestamp at time zone r.time_zone;
    select coalesce(jsonb_agg(jsonb_build_object('title',v->'title','priority',v->'priority','dueDate',v->'due_date') order by v->>'id'),'[]') into tasks
      from jsonb_array_elements(s->'tasks') v where (v->>'due_date')::date<=r.start_date or ((v->>'scheduled_start')::timestamptz>=lo and (v->>'scheduled_start')::timestamptz<hi);
    for x in select value from jsonb_array_elements((s->'events')||(s->'sessions')||(s->'external')) loop
      if (x->>'starts_at')::timestamptz<hi and (x->>'ends_at')::timestamptz>lo then
        events:=events||jsonb_build_array(jsonb_build_object('title',x->'title','start',x->'starts_at','end',x->'ends_at','allDay',coalesce(x->'all_day','false'::jsonb),'source',coalesce(x->>'source','work_session')));
      end if;
    end loop;
    for x in select value from jsonb_array_elements(s->'classes') loop
      -- A class's own weekday may differ from the workspace calendar day.
      for meeting_day in select g::date from generate_series(
        (lo at time zone (x->>'time_zone'))::date::timestamp,
        ((hi-interval '1 microsecond') at time zone (x->>'time_zone'))::date::timestamp,
        interval '1 day') g loop
        if meeting_day>=(x->>'start_date')::date
          and (x->>'end_date_exclusive' is null or meeting_day<(x->>'end_date_exclusive')::date)
          and (x->'weekdays') @> jsonb_build_array(extract(dow from meeting_day)::integer) then
          start_at:=(meeting_day::text||' '||(x->>'start_time'))::timestamp at time zone (x->>'time_zone');
          end_at:=(meeting_day::text||' '||(x->>'end_time'))::timestamp at time zone (x->>'time_zone');
          if start_at<hi and end_at>lo then
            events:=events||jsonb_build_array(jsonb_build_object('title',(x->>'code')||' '||(x->>'name'),'start',start_at,'end',end_at,'allDay',false,'source','course_meeting'));
          end if;
        end if;
      end loop;
    end loop;
    r.source_text:=jsonb_build_object('today',r.start_date,'timeZone',r.time_zone,'tasks',tasks,'events',events)::text;
  else
    r.source_manifest:=ai_private.scoped_source_manifest(d->'selection');
    perform ai_private.validate_scoped_manifest(r.capability,r.source_manifest);
    if r.capability in ('courseMaterialSummary.propose','courseMaterialStudyQuestions.propose') then
      if d->'question' is distinct from 'null'::jsonb then raise exception 'ai_invalid_source';end if;
      if (select count(distinct m.course_id) from public.course_materials m where m.id in(select (v->>'id')::uuid from jsonb_array_elements(r.source_manifest)v) and m.user_id=auth.uid())<>1 then raise exception 'ai_invalid_source';end if;
      select jsonb_agg(jsonb_build_object('title',m.title,'type',m.type,'content',coalesce(m.description,m.title)) order by m.id) into items
        from public.course_materials m where m.id in(select (v->>'id')::uuid from jsonb_array_elements(r.source_manifest)v) and m.user_id=auth.uid();
      if exists(select 1 from jsonb_array_elements(items)v where char_length(v->>'content')>15000) then raise exception 'ai_context_too_large';end if;
      r.source_text:=items::text;
    else
      perform ai_private.strict_text(d->'question',1000,true);
      kind:=r.source_manifest->0->>'kind';selected_id:=(r.source_manifest->0->>'id')::uuid;
      if kind='note' then select jsonb_build_object('entityType','note','title',title,'body',body) into s from public.notes where notes.id=selected_id and user_id=auth.uid();
      elsif kind='context_task' then select jsonb_build_object('entityType','task','title',title,'body',jsonb_build_object('description',description,'dueDate',due_date,'priority',priority,'status',status)::text) into s from public.tasks where tasks.id=selected_id and user_id=auth.uid();
      elsif kind='context_course' then select jsonb_build_object('entityType','course','title',code||' '||name,'body',jsonb_build_object('instructor',instructor,'location',location)::text) into s from public.courses where courses.id=selected_id and user_id=auth.uid();
      else select jsonb_build_object('entityType','course_material','title',title,'body',coalesce(description,title)) into s from public.course_materials where course_materials.id=selected_id and user_id=auth.uid();end if;
      if s is null or char_length(s->>'body')>15000 then raise exception 'ai_context_too_large';end if;
      r.source_text:=(s||jsonb_build_object('userQuestion',d->'question'))::text;
    end if;
  end if;
  return ai_private.save_text_request(r);
end $$;

create function public.ai_record_informational(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$ declare d jsonb;r public.ai_scoped_requests;begin
  d:=ai_private.verify_command(p_message,p_mac,'record_scoped_proposal');
  select * into r from public.ai_scoped_requests where id=(d->>'request_id')::uuid and user_id=auth.uid();
  if not ai_private.informational_capability(r.capability) or r.trust_version is distinct from 2 then raise exception 'ai_capability_denied';end if;
  if not exists(select 1 from public.ai_inference_attempts where scoped_request_id=r.id and user_id=auth.uid() and capability=r.capability and status='dispatching') then raise exception 'ai_transfer_unavailable';end if;
  return public.ai_record_scoped_proposal(p_message,p_mac);
end $$;

alter function ai_private.inference_source(uuid,uuid,uuid) rename to inference_source_pass2;
create function ai_private.inference_source(p_checklist uuid,p_course uuid,p_scoped uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$ declare r public.ai_scoped_requests;begin
  if p_scoped is not null then select * into r from public.ai_scoped_requests where id=p_scoped and user_id=auth.uid();end if;
  if ai_private.informational_capability(r.capability) then
    if num_nonnulls(p_checklist,p_course,p_scoped)<>1 then raise exception 'ai_capability_denied';end if;
    r:=ai_private.lock_scoped_request(p_scoped);if r.status<>'prepared' then raise exception 'ai_request_unavailable';end if;return r.expires_at;
  end if;
  return ai_private.inference_source_pass2(p_checklist,p_course,p_scoped);
end $$;

-- Claim-time policy remains the final cloud authority, independent per purpose.
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
      else false end from public.ai_preferences where user_id=auth.uid()),false)
$$;

revoke all on function ai_private.informational_capability(text),ai_private.daily_state(),
  ai_private.scoped_source_fingerprint(text,uuid),ai_private.scoped_source_fingerprint_pass2(text,uuid),
  ai_private.validate_scoped_manifest(text,jsonb),ai_private.validate_scoped_manifest_pass2(text,jsonb),
  ai_private.strict_text_array(jsonb,integer,integer),ai_private.validate_scoped_output(text,jsonb,text),ai_private.validate_scoped_output_pass2(text,jsonb,text),
  ai_private.scoped_review_target(public.ai_scoped_requests),ai_private.scoped_review_target_pass2(public.ai_scoped_requests),
  ai_private.new_text_request(jsonb,text),ai_private.save_text_request(public.ai_scoped_requests),
  ai_private.inference_source(uuid,uuid,uuid),ai_private.inference_source_pass2(uuid,uuid,uuid),
  public.ai_prepare_informational(text,text),public.ai_record_informational(text,text) from public,anon,authenticated;
grant execute on function public.ai_prepare_informational(text,text),public.ai_record_informational(text,text) to authenticated;

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
  elsif ai_private.informational_capability(q.capability) then
    if (new.provider in ('gemini','openrouter')) is distinct from (new.location='cloud') then raise exception 'ai_capability_denied';end if;
  else raise exception 'ai_capability_denied';end if;return new;
end $$;
