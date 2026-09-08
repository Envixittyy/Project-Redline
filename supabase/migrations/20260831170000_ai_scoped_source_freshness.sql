-- Repair Pass 1. Private canonical fingerprints and strict output validators.
-- No product activation, RPC grants, provider egress or new revision framework.
create function ai_private.scoped_hash(value jsonb) returns text
language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(value::text,'UTF8')),'hex')
$$;

create function ai_private.exact_keys(value jsonb, required text[], optional text[] default '{}') returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' then raise exception 'ai_invalid_shape'; end if;
  if not value ?& required or exists(select 1 from jsonb_object_keys(value) k where not k=any(required||optional)) then
    raise exception 'ai_invalid_shape';
  end if;
end $$;

create function ai_private.strict_text(value jsonb, max_chars integer, multiline boolean default false) returns void
language plpgsql set search_path='' as $$
declare t text:=value#>>'{}';
begin
  if jsonb_typeof(value) is distinct from 'string' or char_length(t) not between 1 and max_chars
    or t !~ '[^[:space:]]' or
    (case when multiline then replace(replace(t,chr(9),''),chr(10),'') else t end) ~ '[[:cntrl:]]' then
    raise exception 'ai_invalid_proposal';
  end if;
end $$;

-- Finite registry. Only the two Note schemas needed to certify this foundation
-- are supported. Every other product contract remains unregistered and denied.
create function ai_private.validate_scoped_output(capability text, proposal jsonb, handle text) returns void
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
  else raise exception 'ai_capability_denied';
  end if;
  if proposal->'schema_version' is distinct from '1'::jsonb or proposal->'source_handle' is distinct from to_jsonb(handle) then
    raise exception 'ai_invalid_proposal';
  end if;
end $$;

-- A Course row is the collection lock, including empty meeting sets. This
-- catches insert/delete/reparent phantoms; every normal meeting write shares it.
create function public.ai_lock_course_meeting_sources() returns trigger
language plpgsql security invoker set search_path='' as $$
declare old_id uuid; new_id uuid;
begin
  if tg_op<>'INSERT' then old_id:=old.course_id; end if;
  if tg_op<>'DELETE' then new_id:=new.course_id; end if;
  perform id from public.courses where id in (old_id,new_id) order by id for update;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger ai_course_meeting_source_lock before insert or update or delete on public.course_meetings
  for each row execute function public.ai_lock_course_meeting_sources();

-- Returns only an integrity fingerprint, never context or credentials. Explicit
-- per-domain projections, fixed UTC serialization and sorted child identities.
-- Private callers hold these locks until mutation AND audit commit together.
create function ai_private.scoped_source_fingerprint(kind text, source_id uuid) returns text
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare state jsonb; children jsonb; n public.notes%rowtype; course_row public.courses%rowtype;
  p public.school_assessment_predictions%rowtype; v public.captures%rowtype;
  linked jsonb:='[]';
begin
  if auth.uid() is null then raise exception 'ai_authorization_denied'; end if;
  case kind
  when 'note' then
    select * into n from public.notes where id=source_id and user_id=auth.uid() for update;
    if not found or n.archived_at is not null then raise exception 'ai_source_unavailable'; end if;
    state:=jsonb_build_array(n.id,n.title,n.body,n.task_id,n.course_id,n.archived_at,n.updated_at);
  when 'course_meetings' then
    select * into course_row from public.courses where id=source_id and user_id=auth.uid() for update;
    if not found or course_row.archived_at is not null then raise exception 'ai_source_unavailable'; end if;
    if (select count(*) from public.course_meetings where course_id=course_row.id)>100 then raise exception 'ai_context_too_large'; end if;
    if exists(select 1 from public.course_meetings where course_id=course_row.id and user_id<>auth.uid()) then raise exception 'ai_owner_mismatch'; end if;
    select coalesce(jsonb_agg(jsonb_build_array(m.id,m.title,
      (select jsonb_agg(weekday order by weekday) from (select distinct unnest(m.weekdays) as weekday) days),
      m.start_date,m.end_date_exclusive,m.start_time,m.end_time,m.time_zone,m.location) order by m.id),'[]')
      into children from public.course_meetings m where course_id=course_row.id;
    state:=jsonb_build_array(course_row.id,course_row.code,course_row.name,course_row.instructor,course_row.location,course_row.archived_at,children);
  when 'capture' then
    select * into v from public.captures where id=source_id and user_id=auth.uid() for update;
    if not found or v.kind not in ('text','pasted_text') then raise exception 'ai_source_unavailable'; end if;
    state:=jsonb_build_array(v.id,v.kind,v.raw_content,v.stage,v.interpretation_id,v.operation_batch_id);
  when 'course_material' then
    select jsonb_build_array(m.id,m.course_id,m.type,m.title,m.description,m.url,c.archived_at)
      into state from public.course_materials m join public.courses c on c.id=m.course_id
      where m.id=source_id and m.user_id=auth.uid() and c.user_id=auth.uid() and c.archived_at is null for update of m,c;
  when 'calendar_event' then
    -- Existing native target state only. Legacy academic rows have no trustworthy
    -- source/import baseline; a title hash cannot make them an import source.
    select jsonb_build_array(id,source,external_id,title,description,starts_at,ends_at,all_day,event_type,course,updated_at)
      into state from public.calendar_events where id=source_id and user_id=auth.uid() and source='life_os' for update;
  when 'external_calendar_event' then
    select jsonb_build_array(a.id,a.provider,a.status,c.id,c.external_calendar_id,c.selected,
      e.id,e.external_event_id,e.revision,e.content_hash,e.title,e.starts_at,e.ends_at,e.all_day,e.status,e.missing_since)
      into state from public.external_calendar_events e join public.external_calendars c on c.id=e.calendar_id
      join public.external_calendar_accounts a on a.id=c.account_id
      where e.id=source_id and e.user_id=auth.uid() and c.user_id=auth.uid() and a.user_id=auth.uid()
        and a.status='connected' and e.missing_since is null and e.status<>'cancelled' for update of a,c,e;
  when 'blackboard_record' then
    select jsonb_build_array(a.id,a.provider,a.status,e.id,e.external_uid,e.proposal_revision,e.content_hash,
      e.normalized_title,e.normalized_description,e.course_id,e.due_date,e.due_at,e.due_precision,e.missing_since)
      into state from public.external_records e join public.integration_accounts a on a.id=e.account_id
      where e.id=source_id and e.user_id=auth.uid() and a.user_id=auth.uid() and a.status='connected'
        and e.provider='blackboard' and e.external_uid not like 'fallback:%' and e.missing_since is null for update of a,e;
  when 'prediction' then
    select * into p from public.school_assessment_predictions where id=source_id and user_id=auth.uid() for update;
    if not found or p.status<>'active' then raise exception 'ai_source_unavailable'; end if;
    linked:=jsonb_build_array(ai_private.scoped_source_fingerprint('course_meetings',p.course_id));
    if p.syllabus_material_id is not null then linked:=linked||jsonb_build_array(ai_private.scoped_source_fingerprint('course_material',p.syllabus_material_id)); end if;
    if p.blackboard_record_id is not null then linked:=linked||jsonb_build_array(ai_private.scoped_source_fingerprint('blackboard_record',p.blackboard_record_id)); end if;
    if p.academic_calendar_id is not null then linked:=linked||jsonb_build_array(ai_private.scoped_source_fingerprint('calendar_event',p.academic_calendar_id)); end if;
    -- Detects current-state changes, NOT generation authenticity. No prediction
    -- capability is registered until generation provenance is repaired in Pass 2.
    state:=jsonb_build_array(to_jsonb(p),linked);
  else raise exception 'ai_source_kind_denied';
  end case;
  if state is null then raise exception 'ai_source_unavailable'; end if;
  if octet_length(state::text)>131072 then raise exception 'ai_context_too_large'; end if;
  return ai_private.scoped_hash(jsonb_build_array(1,auth.uid(),kind,state));
end $$;

create function ai_private.scoped_source_manifest(selection jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ref jsonb; result jsonb:='[]'; source_id uuid;
begin
  if jsonb_typeof(selection) is distinct from 'array' then raise exception 'ai_invalid_source'; end if;
  if jsonb_array_length(selection) not between 1 and 8 then raise exception 'ai_invalid_source'; end if;
  for ref in select * from jsonb_array_elements(selection) order by value->>'kind',value->>'id' loop
    perform ai_private.exact_keys(ref,array['kind','id']);
    if jsonb_typeof(ref->'kind') is distinct from 'string' or jsonb_typeof(ref->'id') is distinct from 'string'
      or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'ai_invalid_source'; end if;
    source_id:=(ref->>'id')::uuid;
    if exists(select 1 from jsonb_array_elements(result) e where e->>'kind'=ref->>'kind' and e->>'id'=ref->>'id') then raise exception 'ai_invalid_source'; end if;
    result:=result||jsonb_build_array(ref||jsonb_build_object('fingerprint',ai_private.scoped_source_fingerprint(ref->>'kind',source_id)));
  end loop;
  return result;
end $$;

-- Capability membership is independent of the reusable fingerprint readers.
-- Adding a reader never permits it as context for an unrelated capability.
create function ai_private.validate_scoped_manifest(capability text, manifest jsonb) returns void
language plpgsql set search_path='' as $$
declare ref jsonb;
begin
  if capability not in ('noteRewrite.propose','noteActionItems.propose') or capability is null then raise exception 'ai_capability_denied'; end if;
  if jsonb_typeof(manifest) is distinct from 'array' then raise exception 'ai_invalid_source'; end if;
  if jsonb_array_length(manifest)<>1 then raise exception 'ai_invalid_source'; end if;
  ref:=manifest->0;
  perform ai_private.exact_keys(ref,array['kind','id','fingerprint']);
  if ref->'kind' is distinct from '"note"'::jsonb or jsonb_typeof(ref->'id') is distinct from 'string'
    or ref->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(ref->'fingerprint') is distinct from 'string' or ref->>'fingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'ai_invalid_source'; end if;
end $$;

revoke all on function ai_private.scoped_hash(jsonb),ai_private.exact_keys(jsonb,text[],text[]),
  ai_private.strict_text(jsonb,integer,boolean),ai_private.validate_scoped_output(text,jsonb,text),
  ai_private.scoped_source_fingerprint(text,uuid),ai_private.scoped_source_manifest(jsonb),ai_private.validate_scoped_manifest(text,jsonb),
  public.ai_lock_course_meeting_sources() from public,anon,authenticated;
