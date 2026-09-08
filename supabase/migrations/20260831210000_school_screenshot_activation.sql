-- Repair Pass 2C: activate only Schedule and Blackboard screenshot proposals by
-- composing Pass-1 review authority with Pass-2A validated image disclosures.

create function ai_private.validated_image_fingerprint(source_id uuid) returns text
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare i public.ai_validated_images; state jsonb;
begin
  select * into i from public.ai_validated_images where id=source_id and user_id=auth.uid() for update;
  if not found or i.status<>'active' or i.expires_at<=clock_timestamp() or i.normalized_bytes is null
    or encode(sha256(i.normalized_bytes),'hex')<>i.normalized_digest then raise exception 'ai_source_unavailable'; end if;
  state:=jsonb_build_array(i.id,i.capability,i.normalized_mime,i.normalized_digest,i.normalized_byte_count,i.width,i.height,i.status,i.created_at,i.expires_at);
  return ai_private.scoped_hash(jsonb_build_array(1,auth.uid(),'validated_image',state));
end $$;

create or replace function ai_private.scoped_source_manifest(selection jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ref jsonb; result jsonb:='[]'; source_id uuid; fingerprint text;
begin
  if jsonb_typeof(selection) is distinct from 'array' or jsonb_array_length(selection) not between 1 and 8 then raise exception 'ai_invalid_source'; end if;
  for ref in select * from jsonb_array_elements(selection) order by value->>'kind',value->>'id' loop
    perform ai_private.exact_keys(ref,array['kind','id']);
    if jsonb_typeof(ref->'kind') is distinct from 'string' or jsonb_typeof(ref->'id') is distinct from 'string'
      or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'ai_invalid_source'; end if;
    source_id:=(ref->>'id')::uuid;
    if exists(select 1 from jsonb_array_elements(result) e where e->>'kind'=ref->>'kind' and e->>'id'=ref->>'id') then raise exception 'ai_invalid_source'; end if;
    fingerprint:=case when ref->>'kind'='validated_image' then ai_private.validated_image_fingerprint(source_id)
      else ai_private.scoped_source_fingerprint(ref->>'kind',source_id) end;
    result:=result||jsonb_build_array(ref||jsonb_build_object('fingerprint',fingerprint));
  end loop;
  return result;
end $$;

create or replace function ai_private.validate_scoped_manifest(capability text, manifest jsonb) returns void
language plpgsql set search_path='' as $$
declare ref jsonb;
begin
  if capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then
    if jsonb_typeof(manifest) is distinct from 'array' or jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source'; end if;
    ref:=manifest->0; perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
    if ref->>'kind' is distinct from 'validated_image' or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source'; end if; return;
  elsif capability='schoolAssessmentPrediction.propose' then
    if jsonb_typeof(manifest) is distinct from 'array' or jsonb_array_length(manifest)<>2 or manifest->0->>'kind' is distinct from 'course_material'
      or manifest->1->>'kind' is distinct from 'course_meetings' then raise exception 'ai_invalid_source'; end if;
    for ref in select * from jsonb_array_elements(manifest) loop perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
      if ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source'; end if; end loop; return;
  elsif capability not in ('noteRewrite.propose','noteActionItems.propose') or capability is null then raise exception 'ai_capability_denied'; end if;
  if jsonb_typeof(manifest) is distinct from 'array' or jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source'; end if;
  ref:=manifest->0; perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
  if ref->>'kind' is distinct from 'note' or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source'; end if;
end $$;

create or replace function ai_private.validate_scoped_output(capability text, proposal jsonb, handle text) returns void
language plpgsql set search_path='' as $$
declare item jsonb; meeting jsonb; d text;
begin
  if capability='schoolScheduleImage.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','courses']);
    if proposal->>'type' is distinct from 'review_schedule_import' or jsonb_typeof(proposal->'courses') is distinct from 'array'
      or jsonb_array_length(proposal->'courses')>12 or octet_length(proposal::text)>45056 then raise exception 'ai_invalid_proposal'; end if;
    for item in select * from jsonb_array_elements(proposal->'courses') loop
      perform ai_private.exact_keys(item,array['code','name','meetings','decision'],array['targetCourseId','targetFingerprint']);
      perform ai_private.strict_text(item->'code',20); perform ai_private.strict_text(item->'name',100);
      if ((item->>'code')||' '||(item->>'name'))~*'(https?://|www\.)' or item->>'decision' not in ('MATCH_EXISTING','CREATE_NEW','IGNORE')
        or jsonb_typeof(item->'meetings') is distinct from 'array' or jsonb_array_length(item->'meetings') not between 1 and 7 then raise exception 'ai_invalid_proposal'; end if;
      if item->>'decision'='MATCH_EXISTING' then
        if item->>'targetCourseId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or item->>'targetFingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_proposal'; end if;
      elsif item ? 'targetCourseId' or item ? 'targetFingerprint' then raise exception 'ai_invalid_proposal'; end if;
      for meeting in select * from jsonb_array_elements(item->'meetings') loop
        perform ai_private.exact_keys(meeting,array['weekday','startTime'],array['endTime','room']);
        if meeting->>'weekday' not in ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')
          or meeting->>'startTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'ai_invalid_proposal'; end if;
        if meeting ? 'endTime' and (meeting->>'endTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (meeting->>'startTime')::time >= (meeting->>'endTime')::time) then raise exception 'ai_invalid_proposal'; end if;
        if item->>'decision'<>'IGNORE' and not meeting ? 'endTime' then raise exception 'ai_invalid_proposal'; end if;
        if meeting ? 'room' then perform ai_private.strict_text(meeting->'room',50); if meeting->>'room'~*'(https?://|www\.)' then raise exception 'ai_invalid_proposal'; end if; end if;
      end loop;
    end loop;
  elsif capability='blackboardCourseImage.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','courses']);
    if proposal->>'type' is distinct from 'review_blackboard_courses' or jsonb_typeof(proposal->'courses') is distinct from 'array'
      or jsonb_array_length(proposal->'courses')>20 or octet_length(proposal::text)>32768 then raise exception 'ai_invalid_proposal'; end if;
    for item in select * from jsonb_array_elements(proposal->'courses') loop
      perform ai_private.exact_keys(item,array['sourceLabel','decision'],array['code','title','targetCourseId','targetFingerprint']);
      perform ai_private.strict_text(item->'sourceLabel',160); if item ? 'code' then perform ai_private.strict_text(item->'code',20); end if;
      if item ? 'title' then perform ai_private.strict_text(item->'title',120); end if;
      if item::text~*'(https?://|www\.)' or item->>'decision' not in ('MATCH_EXISTING','CREATE_NEW','IGNORE') then raise exception 'ai_invalid_proposal'; end if;
      if item->>'decision'='CREATE_NEW' and (not item ? 'code' or not item ? 'title') then raise exception 'ai_invalid_proposal'; end if;
      if item->>'decision'='MATCH_EXISTING' then
        if item->>'targetCourseId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or item->>'targetFingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_proposal'; end if;
      elsif item ? 'targetCourseId' or item ? 'targetFingerprint' then raise exception 'ai_invalid_proposal'; end if;
    end loop;
  elsif capability='noteRewrite.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','rewrittenBody','changesExplanation'],array['rewrittenTitle']);
    if proposal->>'type' is distinct from 'propose_note_rewrite' or octet_length(proposal::text)>32768 then raise exception 'ai_invalid_proposal'; end if;
    perform ai_private.strict_text(proposal->'rewrittenBody',30000,true); perform ai_private.strict_text(proposal->'changesExplanation',1000,true);
    if proposal ? 'rewrittenTitle' then perform ai_private.strict_text(proposal->'rewrittenTitle',100); end if;
  elsif capability='noteActionItems.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','actionItems']);
    if proposal->>'type' is distinct from 'propose_note_action_items' or octet_length(proposal::text)>16384 or jsonb_typeof(proposal->'actionItems') is distinct from 'array'
      or jsonb_array_length(proposal->'actionItems') not between 1 and 20 then raise exception 'ai_invalid_proposal'; end if;
    for item in select * from jsonb_array_elements(proposal->'actionItems') loop perform ai_private.exact_keys(item,array['title'],array['dueDate','priority']); perform ai_private.strict_text(item->'title',200);
      if item ? 'priority' and (jsonb_typeof(item->'priority') is distinct from 'string' or item->>'priority' not in ('low','medium','high','urgent')) then raise exception 'ai_invalid_proposal'; end if;
      if item ? 'dueDate' then d:=item->>'dueDate'; if jsonb_typeof(item->'dueDate') is distinct from 'string' or d !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'ai_invalid_proposal'; end if;
        begin if to_char(d::date,'YYYY-MM-DD')<>d then raise exception 'ai_invalid_proposal'; end if; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'ai_invalid_proposal'; end; end if; end loop;
  elsif capability='schoolAssessmentPrediction.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','predictions']);
    if proposal->>'type' is distinct from 'propose_assessment_predictions' or octet_length(proposal::text)>65536 or jsonb_typeof(proposal->'predictions') is distinct from 'array' or jsonb_array_length(proposal->'predictions')>25 then raise exception 'ai_invalid_proposal'; end if;
    for item in select * from jsonb_array_elements(proposal->'predictions') loop
      perform ai_private.exact_keys(item,array['courseHandle','title','predictionType','predictedDate','confidence','rationale','sourceReferences'],array['predictedTime']);
      if item->'courseHandle' is distinct from to_jsonb(handle)
        or jsonb_typeof(item->'predictionType') is distinct from 'string' or item->>'predictionType' not in ('quiz','exam','assignment','project','milestone','other')
        or jsonb_typeof(item->'confidence') is distinct from 'string' or item->>'confidence' not in ('HIGH','MEDIUM','LOW') then raise exception 'ai_invalid_proposal'; end if;
      perform ai_private.strict_text(item->'title',200); perform ai_private.strict_text(item->'rationale',1000);
      if ((item->>'title')||' '||(item->>'rationale'))~*'(https?://|www\.)' then raise exception 'ai_invalid_proposal'; end if;
      d:=item->>'predictedDate'; if jsonb_typeof(item->'predictedDate') is distinct from 'string' or d !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'ai_invalid_proposal'; end if;
      begin if to_char(d::date,'YYYY-MM-DD')<>d then raise exception 'ai_invalid_proposal'; end if; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'ai_invalid_proposal'; end;
      if item ? 'predictedTime' and (jsonb_typeof(item->'predictedTime') is distinct from 'string' or item->>'predictedTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'ai_invalid_proposal'; end if;
      if jsonb_typeof(item->'sourceReferences') is distinct from 'array' or jsonb_array_length(item->'sourceReferences') not between 1 and 2
        or exists(select 1 from jsonb_array_elements(item->'sourceReferences') ref where jsonb_typeof(ref) is distinct from 'string' or ref#>>'{}' not in (handle||'_course',handle||'_syllabus'))
        or (select count(distinct ref) from jsonb_array_elements(item->'sourceReferences') ref)<>jsonb_array_length(item->'sourceReferences') then raise exception 'ai_invalid_proposal'; end if;
    end loop;
    if (select count(distinct jsonb_build_array(p->'predictionType',p->'title',p->'predictedDate',p->'predictedTime')) from jsonb_array_elements(proposal->'predictions') p)<>jsonb_array_length(proposal->'predictions') then raise exception 'ai_invalid_proposal'; end if;
  else raise exception 'ai_capability_denied'; end if;
  if proposal->'schema_version' is distinct from '1'::jsonb or proposal->'source_handle' is distinct from to_jsonb(handle) then raise exception 'ai_invalid_proposal'; end if;
end $$;

create or replace function ai_private.scoped_review_target(r public.ai_scoped_requests) returns jsonb
language plpgsql set search_path='' as $$ begin
  if r.capability in ('noteRewrite.propose','noteActionItems.propose') then return jsonb_build_object('entity','note','id',r.source_manifest->0->>'id');
  elsif r.capability='schoolAssessmentPrediction.propose' then return jsonb_build_object('entity','course','id',r.source_manifest->1->>'id');
  elsif r.capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then return jsonb_build_object('entity','course','id',r.source_manifest->0->>'id'); end if;
  raise exception 'ai_capability_denied'; end $$;

create or replace function ai_private.finish_scoped_apply(batch_id uuid,result jsonb) returns void
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
  update public.operation_steps set inverse=jsonb_build_object('result',result,'review_digest',b.ai_review_digest,'source_manifest',r.source_manifest,'provider',r.provider,'model',r.model,'evidence','browser_relay','undo_supported',false) where operation_steps.batch_id=b.id and position=0;
  update public.operation_batches set status='committed',committed_at=clock_timestamp() where id=b.id; update public.ai_scoped_requests set status='applied' where id=r.id;
end $$;

create or replace function ai_private.cloud_allowed(p_capability text,p_provider text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select cloud_enabled and cloud_fallback_mode<>'off' and (ai_mode=p_provider or (ai_mode='auto' and (preferred_cloud=p_provider or secondary_cloud))) and
    case p_capability when 'taskChecklist.propose' then checklist_cloud when 'courseImport.propose' then course_import_cloud
      when 'schoolScheduleImage.propose' then school_schedule_cloud and cloud_fallback_mode='ask_each_time'
      when 'blackboardCourseImage.propose' then blackboard_course_cloud and cloud_fallback_mode='ask_each_time' else false end
    from public.ai_preferences where user_id=auth.uid()),false)
$$;

create or replace function ai_private.inference_source(p_checklist uuid,p_course uuid,p_scoped uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare r public.ai_scoped_requests; x jsonb;
begin
  if p_scoped is null then return ai_private.inference_source(p_checklist,p_course); end if;
  if num_nonnulls(p_checklist,p_course,p_scoped)<>1 then raise exception 'ai_capability_denied'; end if;
  select * into r from public.ai_scoped_requests where id=p_scoped and user_id=auth.uid();
  if not found or r.trust_version is distinct from 2 or r.capability not in ('schoolAssessmentPrediction.propose','schoolScheduleImage.propose','blackboardCourseImage.propose') then raise exception 'school_intelligence_review_required'; end if;
  r:=ai_private.lock_scoped_request(p_scoped); if r.status<>'prepared' then raise exception 'ai_request_unavailable'; end if;
  if r.capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then
    x:=r.source_text::jsonb; if not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=auth.uid()
      and d.image_id=(r.source_manifest->0->>'id')::uuid and d.capability=r.capability and d.provider=r.provider and d.model=r.model
      and d.status in ('prepared','awaiting_consent','consented') and d.expires_at>clock_timestamp()) then raise exception 'ai_disclosure_unavailable'; end if;
  end if; return r.expires_at;
end $$;

create or replace function public.ai_school_prediction_attempt_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.ai_scoped_requests; x jsonb;
begin
  if new.scoped_request_id is null then return new; end if; select * into r from public.ai_scoped_requests where id=new.scoped_request_id and user_id=new.user_id;
  if r.trust_version is null then return new; end if;
  if r.trust_version is distinct from 2 or new.capability is distinct from r.capability or new.provider is distinct from r.provider or new.model is distinct from r.model or new.parent_id is not null then raise exception 'ai_capability_denied'; end if;
  if r.capability='schoolAssessmentPrediction.propose' then if new.location not in ('local','remote_local') then raise exception 'ai_capability_denied'; end if;
  elsif r.capability in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then
    x:=r.source_text::jsonb; if new.location is distinct from x->>'location' or not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=new.user_id and d.capability=r.capability and d.provider=new.provider and d.model=new.model and d.location=new.location) then raise exception 'ai_capability_denied'; end if;
  else raise exception 'ai_capability_denied'; end if; return new;
end $$;

create function public.ai_prepare_school_screenshot(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; r public.ai_scoped_requests; i public.ai_validated_images; x public.ai_image_disclosures;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_school_screenshot'); perform ai_private.exact_keys(d,array['image_id','disclosure_id','capability','provider','model','location','file_name','time_zone']);
  if d->>'capability' not in ('schoolScheduleImage.propose','blackboardCourseImage.propose') or d->>'provider' not in ('ollama','openai_compatible','gemini','openrouter')
    or d->>'location' not in ('local','remote_local','cloud') or d->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    or char_length(d->>'file_name') not between 1 and 200 or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'time_zone') then raise exception 'ai_invalid_source'; end if;
  select * into i from public.ai_validated_images where id=(d->>'image_id')::uuid and user_id=auth.uid() for update;
  select * into x from public.ai_image_disclosures where id=(d->>'disclosure_id')::uuid and user_id=auth.uid() for update;
  if i.id is null or x.id is null or i.status<>'active' or i.expires_at<=clock_timestamp() or x.image_id<>i.id or x.capability<>i.capability or x.capability<>d->>'capability'
    or x.provider<>d->>'provider' or x.model<>d->>'model' or x.location<>d->>'location' or x.image_digest<>i.normalized_digest
    or x.image_byte_count<>i.normalized_byte_count or x.status not in ('prepared','awaiting_consent') then raise exception 'ai_disclosure_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  if (select count(*) from public.ai_scoped_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'ai_rate_limited'; end if;
  r.id:=gen_random_uuid();r.user_id:=auth.uid();r.capability:=d->>'capability';r.source_handle:='image_'||replace(gen_random_uuid()::text,'-','');
  r.source_manifest:=ai_private.scoped_source_manifest(jsonb_build_array(jsonb_build_object('kind','validated_image','id',i.id)));
  r.source_text:=jsonb_build_object('imageId',i.id,'disclosureId',x.id,'imageDigest',i.normalized_digest,'imageBytes',i.normalized_byte_count,'location',x.location)::text;
  r.source_digest:=encode(sha256(convert_to(r.source_text,'UTF8')),'hex');r.file_name:=d->>'file_name';r.provider:=d->>'provider';r.model:=d->>'model';r.time_zone:=d->>'time_zone';
  r.created_at:=clock_timestamp();r.expires_at:=least(i.expires_at,x.expires_at,r.created_at+interval '5 minutes');r.start_date:=(r.created_at at time zone r.time_zone)::date;r.status:='prepared';r.trust_version:=2;r.authority_digest:=ai_private.scoped_request_digest(r);
  insert into public.ai_scoped_requests select (r).*; return r.id;
end $$;

create function public.ai_record_school_screenshot(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; r public.ai_scoped_requests; x jsonb; declare_batch uuid;
begin d:=ai_private.verify_command(p_message,p_mac,'record_school_screenshot'); perform ai_private.exact_keys(d,array['request_id','proposal']);
  select * into r from public.ai_scoped_requests where id=(d->>'request_id')::uuid and user_id=auth.uid();
  if not found or r.capability not in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then raise exception 'ai_capability_denied'; end if;
  x:=r.source_text::jsonb; if not exists(select 1 from public.ai_inference_attempts a where a.scoped_request_id=r.id and a.user_id=auth.uid() and a.status='dispatching' and a.capability=r.capability)
    or not exists(select 1 from public.ai_image_disclosures q where q.id=(x->>'disclosureId')::uuid and q.user_id=auth.uid() and q.status='succeeded' and q.capability=r.capability) then raise exception 'ai_transfer_unavailable'; end if;
  -- Re-sign for the unchanged Pass-1 internal operation rather than exposing it.
  r:=ai_private.lock_scoped_request(r.id); if r.status<>'prepared' then raise exception 'ai_request_unavailable'; end if;
  declare_batch := ai_private.insert_scoped_review(r,d->'proposal',null);
  update public.ai_scoped_requests set status='proposed' where id=r.id;
  return declare_batch;
end $$;

create function public.ai_revise_school_screenshot(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; b public.operation_batches; r public.ai_scoped_requests; item jsonb; sealed jsonb:='[]'; proposal jsonb; fp text;
begin d:=ai_private.verify_command(p_message,p_mac,'revise_school_screenshot'); perform ai_private.exact_keys(d,array['batch_id','courses']);
  if jsonb_typeof(d->'courses') is distinct from 'array' then raise exception 'ai_invalid_proposal'; end if;
  select * into b from public.operation_batches where id=(d->>'batch_id')::uuid and user_id=auth.uid(); if not found then raise exception 'ai_proposal_unavailable'; end if;
  r:=ai_private.lock_scoped_request(b.ai_scoped_request_id); if r.capability not in ('schoolScheduleImage.propose','blackboardCourseImage.propose') then raise exception 'ai_capability_denied'; end if;
  select * into b from public.operation_batches where id=b.id for update; if b.status<>'proposed' or r.status<>'proposed' then raise exception 'ai_proposal_unavailable'; end if; perform ai_private.assert_scoped_review(b.id);
  for item in select * from jsonb_array_elements(d->'courses') loop
    if r.capability='schoolScheduleImage.propose' then perform ai_private.exact_keys(item,array['code','name','meetings','decision'],array['targetCourseId']);
    else perform ai_private.exact_keys(item,array['sourceLabel','decision'],array['code','title','targetCourseId']); end if;
    if item->>'decision'='MATCH_EXISTING' then if item->>'targetCourseId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'ai_invalid_proposal'; end if;
      fp:=ai_private.scoped_source_fingerprint('course_meetings',(item->>'targetCourseId')::uuid); sealed:=sealed||jsonb_build_array(item||jsonb_build_object('targetFingerprint',fp));
    else if item ? 'targetCourseId' then raise exception 'ai_invalid_proposal'; end if; sealed:=sealed||jsonb_build_array(item); end if;
  end loop;
  proposal:=jsonb_build_object('schema_version',1,'type',case when r.capability='schoolScheduleImage.propose' then 'review_schedule_import' else 'review_blackboard_courses' end,'source_handle',r.source_handle,'courses',sealed);
  perform ai_private.validate_scoped_output(r.capability,proposal,r.source_handle); update public.operation_batches set status='rejected' where id=b.id; return ai_private.insert_scoped_review(r,proposal,b.id);
end $$;

create function ai_private.assert_screenshot_transfer(a jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare x jsonb;
begin select source_text::jsonb into x from public.ai_scoped_requests where id=(a->>'request_id')::uuid and user_id=auth.uid();
  if not exists(select 1 from public.ai_inference_attempts t where t.scoped_request_id=(a->>'request_id')::uuid and t.user_id=auth.uid() and t.status='succeeded' and t.capability=a->>'capability')
    or not exists(select 1 from public.ai_image_disclosures d where d.id=(x->>'disclosureId')::uuid and d.user_id=auth.uid() and d.status='succeeded' and d.capability=a->>'capability') then raise exception 'ai_transfer_unavailable'; end if;
end $$;

create function public.ai_apply_school_schedule(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; item jsonb; m jsonb; cid uuid; ids jsonb:='[]'; day smallint; normalized text; course_name text; request_row public.ai_scoped_requests;
begin a:=ai_private.begin_scoped_apply(p_message,p_mac,'schoolScheduleImage.propose'); perform ai_private.assert_screenshot_transfer(a);
  select * into request_row from public.ai_scoped_requests where id=(a->>'request_id')::uuid and user_id=auth.uid();
  for item in select * from jsonb_array_elements(a->'proposal'->'courses') loop
    if item->>'decision'='IGNORE' then continue; elsif item->>'decision'='MATCH_EXISTING' then
      cid:=(item->>'targetCourseId')::uuid; if ai_private.scoped_source_fingerprint('course_meetings',cid)<>item->>'targetFingerprint' then raise exception 'ai_source_changed'; end if;
      select name into course_name from public.courses where id=cid and user_id=auth.uid();
    else normalized:=regexp_replace(lower(item->>'code'),'[^a-z0-9]','','g'); if normalized='' or exists(select 1 from public.courses where user_id=auth.uid() and regexp_replace(lower(code),'[^a-z0-9]','','g')=normalized) then raise exception 'ai_course_conflict'; end if;
      course_name:=item->>'name'; insert into public.courses(user_id,code,name) values(auth.uid(),item->>'code',course_name) returning id into cid;
    end if;
    if not (ids @> jsonb_build_array(cid)) then ids:=ids||jsonb_build_array(cid); end if;
    for m in select * from jsonb_array_elements(item->'meetings') loop
      day:=case m->>'weekday' when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4 when 'friday' then 5 else 6 end;
      if not exists(select 1 from public.course_meetings cm where cm.user_id=auth.uid() and cm.course_id=cid and cm.weekdays @> array[day]::smallint[]
        and cm.start_time=(m->>'startTime')::time and cm.end_time=(m->>'endTime')::time and cm.time_zone=request_row.time_zone) then
        insert into public.course_meetings(user_id,course_id,title,weekdays,start_date,start_time,end_time,time_zone,location)
        values(auth.uid(),cid,course_name,array[day]::smallint[],request_row.start_date,(m->>'startTime')::time,(m->>'endTime')::time,request_row.time_zone,m->>'room');
      end if;
    end loop;
  end loop;
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','course_import','ids',ids)); return jsonb_build_object('courseIds',ids);
end $$;

create function public.ai_apply_blackboard_bootstrap(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; item jsonb; cid uuid; ids jsonb:='[]'; normalized text;
begin a:=ai_private.begin_scoped_apply(p_message,p_mac,'blackboardCourseImage.propose'); perform ai_private.assert_screenshot_transfer(a);
  for item in select * from jsonb_array_elements(a->'proposal'->'courses') loop
    if item->>'decision'='IGNORE' then continue; elsif item->>'decision'='MATCH_EXISTING' then cid:=(item->>'targetCourseId')::uuid;
      if ai_private.scoped_source_fingerprint('course_meetings',cid)<>item->>'targetFingerprint' then raise exception 'ai_source_changed'; end if;
    else normalized:=regexp_replace(lower(item->>'code'),'[^a-z0-9]','','g'); if normalized='' or exists(select 1 from public.courses where user_id=auth.uid() and regexp_replace(lower(code),'[^a-z0-9]','','g')=normalized) then raise exception 'ai_course_conflict'; end if;
      insert into public.courses(user_id,code,name) values(auth.uid(),item->>'code',item->>'title') returning id into cid; end if;
    if not (ids @> jsonb_build_array(cid)) then ids:=ids||jsonb_build_array(cid); end if;
  end loop;
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','course_import','ids',ids)); return jsonb_build_object('courseIds',ids);
end $$;

revoke all on function ai_private.validated_image_fingerprint(uuid),ai_private.assert_screenshot_transfer(jsonb),
  public.ai_prepare_school_screenshot(text,text),public.ai_record_school_screenshot(text,text),public.ai_revise_school_screenshot(text,text),
  public.ai_apply_school_schedule(text,text),public.ai_apply_blackboard_bootstrap(text,text) from public,anon,authenticated;
grant execute on function public.ai_prepare_school_screenshot(text,text),public.ai_record_school_screenshot(text,text),public.ai_revise_school_screenshot(text,text),
  public.ai_apply_school_schedule(text,text),public.ai_apply_blackboard_bootstrap(text,text) to authenticated;
