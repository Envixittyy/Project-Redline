-- Pass 2: local text assessment generation from one explicitly selected canonical
-- syllabus and Course/meetings. Extend the Pass-1 finite registries; keep its
-- locks, digests, begin/finish transaction protocol and historical migrations.
-- Shared public entry points remain revoked. School-only wrappers cannot activate
-- Note exemplars or any legacy consumer. Cloud/binary routes remain denied.

alter table public.school_assessment_predictions
  add column generation_request_id uuid references public.ai_scoped_requests(id) on delete restrict,
  add column generation_batch_id uuid references public.operation_batches(id) on delete restrict,
  add column generation_index smallint,
  add constraint prediction_generation_complete check (
    num_nonnulls(generation_request_id,generation_batch_id,generation_index)=0 or
    (num_nonnulls(generation_request_id,generation_batch_id,generation_index)=3 and generation_index between 0 and 24)
  );
create unique index prediction_generation_item on public.school_assessment_predictions(generation_batch_id,generation_index)
  where generation_batch_id is not null;

create or replace function ai_private.validate_scoped_output(capability text, proposal jsonb, handle text) returns void
language plpgsql set search_path='' as $$
declare item jsonb; d text;
begin
  if capability='noteRewrite.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','rewrittenBody','changesExplanation'],array['rewrittenTitle']);
    if proposal->>'type' is distinct from 'propose_note_rewrite' or octet_length(proposal::text)>32768 then raise exception 'ai_invalid_proposal'; end if;
    perform ai_private.strict_text(proposal->'rewrittenBody',30000,true);
    perform ai_private.strict_text(proposal->'changesExplanation',1000,true);
    if proposal ? 'rewrittenTitle' then perform ai_private.strict_text(proposal->'rewrittenTitle',100); end if;
  elsif capability='noteActionItems.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','actionItems']);
    if proposal->>'type' is distinct from 'propose_note_action_items' or octet_length(proposal::text)>16384
      or jsonb_typeof(proposal->'actionItems') is distinct from 'array' then raise exception 'ai_invalid_proposal'; end if;
    if jsonb_array_length(proposal->'actionItems') not between 1 and 20 then raise exception 'ai_invalid_proposal'; end if;
    for item in select * from jsonb_array_elements(proposal->'actionItems') loop
      perform ai_private.exact_keys(item,array['title'],array['dueDate','priority']);
      perform ai_private.strict_text(item->'title',200);
      if item ? 'priority' and (jsonb_typeof(item->'priority') is distinct from 'string' or item->>'priority' not in ('low','medium','high','urgent')) then raise exception 'ai_invalid_proposal'; end if;
      if item ? 'dueDate' then
        d:=item->>'dueDate';
        if jsonb_typeof(item->'dueDate') is distinct from 'string' or d !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'ai_invalid_proposal'; end if;
        begin
          if to_char(d::date,'YYYY-MM-DD')<>d then raise exception 'ai_invalid_proposal'; end if;
        exception when datetime_field_overflow or invalid_datetime_format then raise exception 'ai_invalid_proposal'; end;
      end if;
    end loop;

  elsif capability='schoolAssessmentPrediction.propose' then
    perform ai_private.exact_keys(proposal,array['schema_version','type','source_handle','predictions']);
    if proposal->>'type' is distinct from 'propose_assessment_predictions' or octet_length(proposal::text)>65536
      or jsonb_typeof(proposal->'predictions') is distinct from 'array' then raise exception 'ai_invalid_proposal'; end if;
    if jsonb_array_length(proposal->'predictions')>25 then raise exception 'ai_invalid_proposal'; end if;
    for item in select * from jsonb_array_elements(proposal->'predictions') loop
      perform ai_private.exact_keys(item,array['courseHandle','title','predictionType','predictedDate','confidence','rationale','sourceReferences'],array['predictedTime']);
      if item->'courseHandle' is distinct from to_jsonb(handle)
        or jsonb_typeof(item->'predictionType') is distinct from 'string' or item->>'predictionType' not in ('quiz','exam','assignment','project','milestone','other')
        or jsonb_typeof(item->'confidence') is distinct from 'string' or item->>'confidence' not in ('HIGH','MEDIUM','LOW') then raise exception 'ai_invalid_proposal'; end if;
      perform ai_private.strict_text(item->'title',200);
      perform ai_private.strict_text(item->'rationale',1000);
      if ((item->>'title')||' '||(item->>'rationale')) ~* '(https?://|www\.)' then raise exception 'ai_invalid_proposal'; end if;
      d:=item->>'predictedDate';
      if jsonb_typeof(item->'predictedDate') is distinct from 'string' or d !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'ai_invalid_proposal'; end if;
      begin
        if to_char(d::date,'YYYY-MM-DD')<>d then raise exception 'ai_invalid_proposal'; end if;
      exception when datetime_field_overflow or invalid_datetime_format then raise exception 'ai_invalid_proposal'; end;
      if item ? 'predictedTime' and (jsonb_typeof(item->'predictedTime') is distinct from 'string' or item->>'predictedTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'ai_invalid_proposal'; end if;
      if jsonb_typeof(item->'sourceReferences') is distinct from 'array' then raise exception 'ai_invalid_proposal'; end if;
      if jsonb_array_length(item->'sourceReferences') not between 1 and 2
        or exists(select 1 from jsonb_array_elements(item->'sourceReferences') ref where jsonb_typeof(ref) is distinct from 'string' or ref#>>'{}' not in (handle||'_course',handle||'_syllabus'))
        or (select count(distinct ref) from jsonb_array_elements(item->'sourceReferences') ref)<>jsonb_array_length(item->'sourceReferences') then raise exception 'ai_invalid_proposal'; end if;
    end loop;
    if (select count(distinct jsonb_build_array(p->'predictionType',p->'title',p->'predictedDate',p->'predictedTime')) from jsonb_array_elements(proposal->'predictions') p)<>jsonb_array_length(proposal->'predictions') then raise exception 'ai_invalid_proposal'; end if;
  else raise exception 'ai_capability_denied';
  end if;
  if proposal->'schema_version' is distinct from '1'::jsonb or proposal->'source_handle' is distinct from to_jsonb(handle) then
    raise exception 'ai_invalid_proposal';
  end if;
end $$;

create or replace function ai_private.validate_scoped_manifest(capability text, manifest jsonb) returns void
language plpgsql set search_path='' as $$
declare ref jsonb;
begin
  if capability='schoolAssessmentPrediction.propose' then
    if jsonb_typeof(manifest) is distinct from 'array' then raise exception 'ai_invalid_source'; end if;
    if jsonb_array_length(manifest)<>2 or manifest->0->>'kind' is distinct from 'course_material'
      or manifest->1->>'kind' is distinct from 'course_meetings' then raise exception 'ai_invalid_source'; end if;
    for ref in select * from jsonb_array_elements(manifest) loop
      perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
      if jsonb_typeof(ref->'id') is distinct from 'string' or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        or jsonb_typeof(ref->'fingerprint') is distinct from 'string' or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source'; end if;
    end loop;
    return;
  end if;
  if capability not in ('noteRewrite.propose','noteActionItems.propose') or capability is null then raise exception 'ai_capability_denied'; end if;
  if jsonb_typeof(manifest) is distinct from 'array' then raise exception 'ai_invalid_source'; end if;
  if jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source'; end if;
  ref:=manifest->0;
  perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
  if ref->'kind' is distinct from '"note"'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string'
    or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(ref->'fingerprint') is distinct from 'string' or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source'; end if;
end $$;

-- Fixed target metadata only; this is not a dynamic mutation dispatcher.
create function ai_private.scoped_review_target(r public.ai_scoped_requests) returns jsonb
language plpgsql set search_path='' as $$
begin
  if r.capability in ('noteRewrite.propose','noteActionItems.propose') then
    return jsonb_build_object('entity','note','id',r.source_manifest->0->>'id');
  elsif r.capability='schoolAssessmentPrediction.propose' then
    return jsonb_build_object('entity','course','id',r.source_manifest->1->>'id');
  end if;
  raise exception 'ai_capability_denied';
end $$;

create or replace function ai_private.assert_scoped_review(batch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches%rowtype; r public.ai_scoped_requests%rowtype; s public.operation_steps%rowtype;
begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid();
  if not found or b.source<>'ai' or b.ai_review_digest is null then raise exception 'ai_untrusted_proposal'; end if;
  select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id and user_id=auth.uid();
  if not found or r.trust_version is distinct from 2 or r.authority_digest is distinct from ai_private.scoped_request_digest(r)
    or r.source_digest is distinct from encode(sha256(convert_to(r.source_text,'UTF8')),'hex') then raise exception 'ai_untrusted_source'; end if;
  perform ai_private.validate_scoped_manifest(r.capability,r.source_manifest);
  if (select count(*) from public.operation_steps steps where steps.batch_id=b.id)<>1 then raise exception 'ai_invalid_proposal'; end if;
  select * into s from public.operation_steps where operation_steps.batch_id=b.id and user_id=auth.uid() and position=0;
  if not found or s.action_type is distinct from r.capability or s.target_entity is distinct from (ai_private.scoped_review_target(r)->>'entity') or s.target_id is distinct from (ai_private.scoped_review_target(r)->>'id')::uuid then raise exception 'ai_invalid_proposal'; end if;
  perform ai_private.validate_scoped_output(r.capability,s.input,r.source_handle);
  if r.capability='schoolAssessmentPrediction.propose' and exists(select 1 from jsonb_array_elements(s.input->'predictions') p
    where (p->>'predictedDate')::date<r.start_date or (p->>'predictedDate')::date>r.start_date+366) then raise exception 'ai_invalid_proposal'; end if;
  if b.ai_review_digest is distinct from ai_private.scoped_review_digest(r.authority_digest,b.id,b.ai_predecessor_batch_id,s.input) then raise exception 'ai_review_changed'; end if;
  return jsonb_build_object('batch_id',b.id,'request_id',r.id,'capability',r.capability,
    'source_manifest',r.source_manifest,'proposal',s.input,'digest',b.ai_review_digest,'predecessor',b.ai_predecessor_batch_id,
    'expires_at',r.expires_at,'provider',r.provider,'model',r.model,'evidence','browser_relay');
end $$;

create or replace function ai_private.insert_scoped_review(r public.ai_scoped_requests, proposal jsonb, predecessor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare next_id uuid:=gen_random_uuid();
begin
  perform ai_private.validate_scoped_output(r.capability,proposal,r.source_handle);
  insert into public.operation_batches(id,user_id,source,status,summary,ai_scoped_request_id,ai_predecessor_batch_id,ai_review_digest)
    values(next_id,auth.uid(),'ai','proposed','Scoped AI review',r.id,predecessor,
      ai_private.scoped_review_digest(r.authority_digest,next_id,predecessor,proposal));
  insert into public.operation_steps(user_id,batch_id,position,action_type,target_entity,target_id,input)
    values(auth.uid(),next_id,0,r.capability,ai_private.scoped_review_target(r)->>'entity',(ai_private.scoped_review_target(r)->>'id')::uuid,proposal);
  perform ai_private.assert_scoped_review(next_id);
  return next_id;
end $$;

create or replace function ai_private.finish_scoped_apply(batch_id uuid, result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches; r public.ai_scoped_requests; authority jsonb;
begin
  select * into b from public.operation_batches where id=batch_id and user_id=auth.uid() for update;
  if not found or b.status<>'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id() then raise exception 'ai_consumption_unavailable'; end if;
  authority:=ai_private.assert_scoped_review(b.id);
  select * into r from public.ai_scoped_requests where id=b.ai_scoped_request_id;
  if r.status<>'proposed' or r.expires_at<=clock_timestamp() then raise exception 'ai_request_unavailable'; end if;
  perform ai_private.exact_keys(result,array['entity','ids']);
  if jsonb_typeof(result->'ids') is distinct from 'array' or octet_length(result::text)>4096 then raise exception 'ai_invalid_result'; end if;
  if r.capability='noteRewrite.propose' then
    if result->>'entity' is distinct from 'note' or result->'ids' is distinct from jsonb_build_array(r.source_manifest->0->>'id') then raise exception 'ai_invalid_result'; end if;
  elsif r.capability='noteActionItems.propose' then
    if result->>'entity' is distinct from 'task' or jsonb_array_length(result->'ids')<>jsonb_array_length(authority->'proposal'->'actionItems')
      or (select count(distinct id) from public.tasks where user_id=auth.uid() and id in (select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result'; end if;
  elsif r.capability='schoolAssessmentPrediction.propose' then
    if result->>'entity' is distinct from 'assessment_prediction' or jsonb_array_length(result->'ids')<>jsonb_array_length(authority->'proposal'->'predictions')
      or (select count(*) from public.school_assessment_predictions p where p.user_id=auth.uid() and p.generation_batch_id=b.id
        and p.id in (select value::uuid from jsonb_array_elements_text(result->'ids')))<>jsonb_array_length(result->'ids') then raise exception 'ai_invalid_result'; end if;
  else raise exception 'ai_capability_denied'; end if;
  update public.operation_steps set inverse=jsonb_build_object('result',result,'review_digest',b.ai_review_digest,
    'source_manifest',r.source_manifest,'provider',r.provider,'model',r.model,'evidence','browser_relay','undo_supported',false)
    where operation_steps.batch_id=b.id and position=0;
  update public.operation_batches set status='committed',committed_at=clock_timestamp() where id=b.id;
  update public.ai_scoped_requests set status='applied' where id=r.id;
end $$;

create function public.ai_prepare_school_predictions(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb; r public.ai_scoped_requests; c public.courses; m public.course_materials;
begin
  d:=ai_private.verify_command(p_message,p_mac,'prepare_school_predictions');
  perform ai_private.exact_keys(d,array['course_id','syllabus_material_id','provider','model','time_zone']);
  if jsonb_typeof(d->'course_id') is distinct from 'string' or jsonb_typeof(d->'syllabus_material_id') is distinct from 'string'
    or jsonb_typeof(d->'provider') is distinct from 'string' or d->>'provider' not in ('ollama','llamacpp','openai_compatible')
    or jsonb_typeof(d->'model') is distinct from 'string' or d->>'model' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    or jsonb_typeof(d->'time_zone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'time_zone')
    then raise exception 'ai_invalid_source'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  if (select count(*) from public.ai_scoped_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'ai_rate_limited'; end if;
  -- Follow Apply's request-before-source lock order during recalculation.
  perform id from public.ai_scoped_requests where user_id=auth.uid()
    and capability='schoolAssessmentPrediction.propose' and trust_version=2
    and status in ('prepared','proposed') and source_manifest->1->>'id'=d->>'course_id'
    order by id for update;
  -- Use the foundation's actual canonical readers, including the meeting collection lock.
  r.source_manifest:=ai_private.scoped_source_manifest(jsonb_build_array(
    jsonb_build_object('kind','course_meetings','id',d->>'course_id'),
    jsonb_build_object('kind','course_material','id',d->>'syllabus_material_id')));
  perform ai_private.validate_scoped_manifest('schoolAssessmentPrediction.propose',r.source_manifest);
  select * into c from public.courses where id=(d->>'course_id')::uuid and user_id=auth.uid();
  select * into m from public.course_materials where id=(d->>'syllabus_material_id')::uuid and user_id=auth.uid();
  if m.course_id is distinct from c.id or m.type<>'syllabus' or m.description is null or btrim(m.description)='' then raise exception 'ai_invalid_source'; end if;
  if char_length(m.description)>15000 then raise exception 'ai_context_too_large'; end if;
  r.id:=gen_random_uuid(); r.user_id:=auth.uid(); r.capability:='schoolAssessmentPrediction.propose';
  r.source_handle:='source_'||replace(gen_random_uuid()::text,'-','');
  r.provider:=d->>'provider'; r.model:=d->>'model'; r.time_zone:=d->>'time_zone';
  r.created_at:=clock_timestamp(); r.expires_at:=r.created_at+interval '5 minutes';
  r.start_date:=(r.created_at at time zone r.time_zone)::date; r.status:='prepared'; r.trust_version:=2;
  r.source_text:=jsonb_build_object(
    'course',jsonb_build_object('handle',r.source_handle,'sourceReference',r.source_handle||'_course','code',c.code,'name',c.name),
    'meetings',(select coalesce(jsonb_agg(jsonb_build_object('weekdays',weekdays,'startDate',start_date,'endDateExclusive',end_date_exclusive,
      'startTime',start_time,'endTime',end_time,'timeZone',time_zone) order by id),'[]') from public.course_meetings where course_id=c.id and user_id=auth.uid()),
    'selectedSyllabus',jsonb_build_object('sourceReference',r.source_handle||'_syllabus','title',m.title,'description',m.description),
    'horizon',jsonb_build_object('from',r.start_date,'through',r.start_date+366),'timeZone',r.time_zone)::text;
  if octet_length(r.source_text)>24000 then raise exception 'ai_context_too_large'; end if;
  r.source_digest:=encode(sha256(convert_to(r.source_text,'UTF8')),'hex');
  r.authority_digest:=ai_private.scoped_request_digest(r);
  -- Explicit recalculation retires older pending requests, not persisted history.
  update public.ai_scoped_requests set status='conflict' where user_id=auth.uid()
    and capability=r.capability and trust_version=2 and status in ('prepared','proposed')
    and source_manifest->1->>'id'=c.id::text;
  insert into public.ai_scoped_requests select (r).*;
  return r.id;
end $$;

-- These wrappers grant only the one registered School product, then delegate to
-- the existing foundation record/revise implementations with the SAME signature.
create function public.ai_record_school_predictions(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'record_scoped_proposal');
  if not exists(select 1 from public.ai_scoped_requests where id=(d->>'request_id')::uuid and user_id=auth.uid()
    and trust_version=2 and capability='schoolAssessmentPrediction.propose') then raise exception 'ai_capability_denied'; end if;
  if not exists(select 1 from public.ai_inference_attempts where scoped_request_id=(d->>'request_id')::uuid and user_id=auth.uid()
    and capability='schoolAssessmentPrediction.propose' and location in ('local','remote_local') and status='dispatching') then raise exception 'ai_transfer_unavailable'; end if;
  return public.ai_record_scoped_proposal(p_message,p_mac);
end $$;

create function public.ai_revise_school_predictions(p_message text,p_mac text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  d:=ai_private.verify_command(p_message,p_mac,'revise_scoped_proposal');
  if not exists(select 1 from public.operation_batches b join public.ai_scoped_requests r on r.id=b.ai_scoped_request_id
    where b.id=(d->>'batch_id')::uuid and b.user_id=auth.uid() and r.user_id=auth.uid() and r.trust_version=2
    and r.capability='schoolAssessmentPrediction.propose') then raise exception 'ai_capability_denied'; end if;
  return public.ai_revise_scoped_proposal(p_message,p_mac);
end $$;

-- The protected prediction row records the historical request and exact reviewed
-- item. New attestation can only be inserted during a foundation consumption.
create function public.school_prediction_generation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.operation_batches; r public.ai_scoped_requests; p jsonb;
begin
  if tg_op='UPDATE' and old.generation_batch_id is not null then
    if (to_jsonb(old)-'status'-'updated_at') is distinct from (to_jsonb(new)-'status'-'updated_at') then raise exception 'ai_immutable_prediction'; end if;
    return new;
  end if;
  if tg_op='UPDATE' and new.generation_batch_id is not null then raise exception 'ai_untrusted_generation'; end if;
  if new.generation_batch_id is null then return new; end if; -- Legacy is never attested.
  select * into b from public.operation_batches where id=new.generation_batch_id and user_id=new.user_id;
  select * into r from public.ai_scoped_requests where id=new.generation_request_id and user_id=new.user_id;
  if b.ai_scoped_request_id is distinct from r.id or r.trust_version is distinct from 2 or r.capability is distinct from 'schoolAssessmentPrediction.propose'
    or b.status is distinct from 'confirmed' or b.ai_apply_xid is distinct from pg_current_xact_id()
    or new.course_id is distinct from (r.source_manifest->1->>'id')::uuid then raise exception 'ai_untrusted_generation'; end if;
  select input->'predictions'->new.generation_index into p from public.operation_steps where batch_id=b.id and position=0 and user_id=new.user_id;
  if p is null or new.title is distinct from p->>'title' or new.prediction_type is distinct from p->>'predictionType'
    or new.predicted_date is distinct from (p->>'predictedDate')::date or new.predicted_time is distinct from p->>'predictedTime'
    or new.confidence is distinct from p->>'confidence' or new.rationale is distinct from p->>'rationale'
    or new.source_reference is distinct from (p->'sourceReferences')::text
    or num_nonnulls(new.academic_calendar_id,new.syllabus_material_id,new.blackboard_record_id)<>0 then raise exception 'ai_untrusted_generation'; end if;
  return new;
end $$;
create trigger school_prediction_generation_guard before insert or update on public.school_assessment_predictions
  for each row execute function public.school_prediction_generation_guard();

create function public.ai_apply_school_predictions(p_message text,p_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb; p jsonb; pid uuid; ids jsonb:='[]'; item_index integer:=0;
begin
  a:=ai_private.begin_scoped_apply(p_message,p_mac,'schoolAssessmentPrediction.propose');
  if not exists(select 1 from public.ai_inference_attempts where scoped_request_id=(a->>'request_id')::uuid
    and user_id=auth.uid() and status='succeeded' and location in ('local','remote_local')
    and capability='schoolAssessmentPrediction.propose') then raise exception 'ai_transfer_unavailable'; end if;
  -- Recalculation replaces only attested active predictions for this Course.
  update public.school_assessment_predictions set status='superseded'
    where user_id=auth.uid() and course_id=(a->'source_manifest'->1->>'id')::uuid and status='active' and generation_batch_id is not null;
  for p in select * from jsonb_array_elements(a->'proposal'->'predictions') loop
    insert into public.school_assessment_predictions(user_id,course_id,prediction_type,title,predicted_date,predicted_time,
      confidence,rationale,source_reference,generation_request_id,generation_batch_id,generation_index)
    values(auth.uid(),(a->'source_manifest'->1->>'id')::uuid,p->>'predictionType',p->>'title',(p->>'predictedDate')::date,p->>'predictedTime',
      p->>'confidence',p->>'rationale',(p->'sourceReferences')::text,(a->>'request_id')::uuid,(a->>'batch_id')::uuid,item_index)
    returning id into pid;
    ids:=ids||jsonb_build_array(pid); item_index:=item_index+1;
  end loop;
  perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','assessment_prediction','ids',ids));
  return jsonb_build_object('ok',true,'predictionIds',ids);
end $$;

-- Read-time freshness is comparison only: no inference or deletion on page load.
-- Missing/archived/deleted sources are stale, never grounds for adopting a new basis.
create function public.ai_school_prediction_fresh(p_request_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.ai_scoped_requests; refs jsonb;
begin
  select * into r from public.ai_scoped_requests where id=p_request_id and user_id=auth.uid()
    and trust_version=2 and capability='schoolAssessmentPrediction.propose' and status='applied';
  if not found then return false; end if;
  if r.authority_digest is distinct from ai_private.scoped_request_digest(r) then return false; end if;
  perform ai_private.validate_scoped_manifest(r.capability,r.source_manifest);
  select jsonb_agg(ref-'fingerprint' order by ref->>'kind',ref->>'id') into refs from jsonb_array_elements(r.source_manifest) ref;
  return r.source_manifest=ai_private.scoped_source_manifest(refs);
exception when others then return false;
end $$;

-- Reuse Phase 10B attempts for local text only. Source freshness now comes from
-- Pass 1, not an immutable prompt hash. Binary and all other scoped kinds deny.
create or replace function ai_private.inference_source(p_checklist uuid,p_course uuid,p_scoped uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare r public.ai_scoped_requests;
begin
  if p_scoped is null then return ai_private.inference_source(p_checklist,p_course); end if;
  if num_nonnulls(p_checklist,p_course,p_scoped)<>1 then raise exception 'ai_capability_denied'; end if;
  select * into r from public.ai_scoped_requests where id=p_scoped and user_id=auth.uid();
  if not found or r.trust_version is distinct from 2 or r.capability<>'schoolAssessmentPrediction.propose' then raise exception 'school_intelligence_review_required'; end if;
  r:=ai_private.lock_scoped_request(p_scoped);
  if r.status<>'prepared' then raise exception 'ai_request_unavailable'; end if;
  return r.expires_at;
end $$;

-- Defense in depth against signed mismatched attempt metadata; local model
-- selection is informational browser-relay provenance, never attestation.
create function public.ai_school_prediction_attempt_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.ai_scoped_requests;
begin
  if new.scoped_request_id is null then return new; end if;
  select * into r from public.ai_scoped_requests where id=new.scoped_request_id and user_id=new.user_id;
  if r.trust_version is null then return new; end if; -- Historical attempts remain contained by inference_source.
  if r.trust_version is distinct from 2 or r.capability is distinct from 'schoolAssessmentPrediction.propose'
    or new.capability is distinct from r.capability or new.provider is distinct from r.provider or new.model is distinct from r.model
    or new.location not in ('local','remote_local') or new.parent_id is not null then raise exception 'ai_capability_denied'; end if;
  return new;
end $$;
create trigger ai_school_prediction_attempt_guard before insert on public.ai_inference_attempts
  for each row execute function public.ai_school_prediction_attempt_guard();

revoke all on function ai_private.scoped_review_target(public.ai_scoped_requests),
  public.school_prediction_generation_guard(),public.ai_school_prediction_attempt_guard(),
  public.ai_prepare_school_predictions(text,text),public.ai_record_school_predictions(text,text),
  public.ai_revise_school_predictions(text,text),public.ai_apply_school_predictions(text,text),public.ai_school_prediction_fresh(uuid)
from public,anon,authenticated;
grant execute on function public.ai_prepare_school_predictions(text,text),public.ai_record_school_predictions(text,text),
  public.ai_revise_school_predictions(text,text),public.ai_apply_school_predictions(text,text),public.ai_school_prediction_fresh(uuid)
to authenticated;
