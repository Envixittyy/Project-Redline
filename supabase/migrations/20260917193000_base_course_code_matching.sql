-- Base course-code matching — primary Mapúa course resolution
-- Extracts base course code (<COURSE_CODE>_<SECTION>_<TERM> -> <COURSE_CODE>)
-- and enforces 6-tier course resolution priority with ambiguity fail-closed protection
-- and persistent external mapping caching.

create or replace function public.school_extract_base_course_code(value text) returns text
language sql immutable set search_path='' as $$
  select nullif(upper((regexp_match(btrim(normalize(value, NFKC)), '^([A-Za-z]{2,8}[0-9]{1,5}[A-Za-z0-9]{0,3})_[A-Za-z0-9-]+_[A-Za-z0-9-]+'))[1]), '');
$$;
grant execute on function public.school_extract_base_course_code(text) to authenticated, service_role;

create or replace function public.ingest_school_email(p_user_id uuid, p_event jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_event public.school_email_events%rowtype;
  v_item public.school_items%rowtype;
  v_course uuid; v_candidates uuid[]; v_task uuid;
  v_status text; v_type text := p_event->>'itemType';
  v_kind text := p_event->>'notificationType';
  v_source text := p_event->>'sourceKey';
  v_time timestamptz := (p_event->>'sourceAt')::timestamptz;
  v_due date := (p_event->>'dueDate')::date;
  v_due_at timestamptz := (p_event->>'dueAt')::timestamptz;
  v_new boolean := false;
  v_base_code text;
  v_bb_course_id text;
begin
  if p_event->>'source' is distinct from 'blackboard' or p_event->>'parserVersion' is distinct from 'blackboard-email-v1'
     or p_event->>'status' not in ('parsed','ignored','unknown_type','malformed') then
    raise exception 'Invalid School event' using errcode='22023';
  end if;

  -- Single-user ingestion lock covers different messages, mapping resolution,
  -- logical identity promotion and task creation in the same transaction.
  perform pg_advisory_xact_lock(hashtextextended('school-email:'||p_user_id::text,0));
  select * into v_event from public.school_email_events where user_id=p_user_id and
    (message_key=p_event->>'messageKey' or (provider=p_event->>'provider' and provider_message_id=p_event->>'sourceMessageId')) limit 1 for update;
  if found then
    if v_event.status not in ('unresolved_course','unresolved_item','unresolved_task') then
      return jsonb_build_object('status','duplicate','eventId',v_event.id,'itemId',v_event.item_id,'taskId',(select task_id from public.school_items where id=v_event.item_id));
    end if;
    -- Retries use immutable stored evidence, never replacement caller fields.
    p_event := v_event.parsed_event;
    v_type:=p_event->>'itemType'; v_kind:=p_event->>'notificationType'; v_source:=p_event->>'sourceKey';
    v_time:=(p_event->>'sourceAt')::timestamptz; v_due:=(p_event->>'dueDate')::date; v_due_at:=(p_event->>'dueAt')::timestamptz;
  else
    insert into public.school_email_events(user_id,provider,provider_message_id,message_key,parsed_event,status,received_at)
    values(p_user_id,p_event->>'provider',p_event->>'sourceMessageId',p_event->>'messageKey',p_event,'received',(p_event->>'receivedAt')::timestamptz) returning * into v_event;
  end if;

  v_status := p_event->>'status';
  if v_status='parsed' then
    -- Extract Blackboard course ID from courseKey (e.g. 'learn.example.edu:_165958_1' -> '_165958_1')
    if p_event->>'courseKey' is not null and position(':' in p_event->>'courseKey') > 0 then
      v_bb_course_id := split_part(p_event->>'courseKey', ':', 2);
    else
      v_bb_course_id := null;
    end if;

    -- Course resolution priority:
    -- 1. Existing explicit school_course_mappings mapping
    if v_course is null and p_event->>'courseHint' is not null then
      select m.course_id into v_course
        from public.school_course_mappings m
        join public.courses c on c.id = m.course_id
        where m.user_id = p_user_id
          and c.archived_at is null
          and (
            m.source_course_key = p_event->>'courseHint'
            or public.school_normalize_key(m.source_course_key) = public.school_normalize_key(p_event->>'courseHint')
            or m.source_course_key = 'name:' || public.school_normalize_key(p_event->>'courseHint')
          )
        limit 1;
    end if;

    -- 2. Existing strong Blackboard courseId mapping
    if v_course is null and (p_event->>'courseKey' is not null or v_bb_course_id is not null) then
      select m.course_id into v_course
        from public.school_course_mappings m
        join public.courses c on c.id = m.course_id
        where m.user_id = p_user_id
          and c.archived_at is null
          and (
            m.source_course_key = p_event->>'courseKey'
            or (v_bb_course_id is not null and m.source_course_key = v_bb_course_id)
            or (v_bb_course_id is not null and public.school_normalize_key(m.source_course_key) = public.school_normalize_key(v_bb_course_id))
          )
        limit 1;
    end if;

    -- 3. Exact unique match of the extracted baseCourseCode against courses.code
    v_base_code := coalesce(
      p_event->>'baseCourseCode',
      public.school_extract_base_course_code(p_event->>'courseHint')
    );
    if v_course is null and v_base_code is not null then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and public.school_normalize_key(code) = public.school_normalize_key(v_base_code);
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      elsif cardinality(v_candidates) > 1 then
        -- Ambiguity rule: The base-code match must be unique among the user's active courses.
        -- If two active courses both have the base course code, do not choose arbitrarily.
        -- Return unresolved_course and require explicit mapping.
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 4. Existing exact full-code behavior where applicable
    if v_course is null and v_status = 'parsed' and p_event->>'courseHint' is not null then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and public.school_normalize_key(code) = public.school_normalize_key(p_event->>'courseHint');
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      elsif cardinality(v_candidates) > 1 then
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 5. Exact normalized course-name matching as a fallback
    if v_course is null and v_status = 'parsed' and p_event->>'courseHint' is not null then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and public.school_normalize_key(name) = public.school_normalize_key(p_event->>'courseHint');
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      elsif cardinality(v_candidates) > 1 then
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 6. Otherwise return unresolved_course
    if v_course is null then
      v_status := 'unresolved_course';
    else
      if v_source is not null then
        select * into v_item from public.school_items where user_id=p_user_id and course_id=v_course and source_key=v_source for update;
      end if;
      if v_item.id is null then
        select array_agg(id) into v_candidates from public.school_items
          where user_id=p_user_id and course_id=v_course and title_key=p_event->>'titleKey'
          and (item_type=v_type or (v_type='unknown' and v_kind in ('deadline_changed','reminder') and item_type in ('assignment','quiz','exam')))
          and (v_source is null or source_key is null);
        -- A title is not stable identity. When either side lacks a strong source
        -- key, fail closed instead of merging unrelated same-title course work.
        if cardinality(v_candidates)>0 then v_status:='unresolved_item'; end if;
      end if;
      if v_item.id is not null and v_type<>'unknown' and v_type<>v_item.item_type then v_status:='unresolved_item'; end if;
      if v_item.id is null and (v_kind in ('deadline_changed','reminder') or v_type='unknown') then v_status:='unresolved_item'; end if;
      if v_status='parsed' and v_item.id is null then
        insert into public.school_items(user_id,course_id,item_type,title,title_key,source_key,source_url,due_date,due_at,weight,source_at)
        values(p_user_id,v_course,v_type,p_event->>'title',p_event->>'titleKey',v_source,p_event->>'sourceUrl',v_due,v_due_at,(p_event->>'weight')::numeric,v_time)
        returning * into v_item;
        v_new:=true;
      end if;
      if v_status='parsed' then
        if not v_new and v_time is not null and v_item.source_at is not null and v_time<v_item.source_at then v_status:='stale';
        elsif not v_new and v_kind='deadline_changed' and v_time=v_item.source_at and (v_item.due_date is distinct from v_due or v_item.due_at is distinct from v_due_at) then v_status:='unresolved_item';
        else
          v_task:=v_item.task_id;
          if v_task is not null then
            perform 1 from public.tasks where id=v_task and user_id=p_user_id and course_id=v_course for update;
            if not found then v_status:='unresolved_task'; end if;
          elsif v_item.task_created then v_status:='unresolved_task'; -- Never recreate a user-deleted Task.
          end if;
          if v_status='parsed' then
            if v_new and v_type in ('assignment','quiz','exam') then
              insert into public.tasks(user_id,title,status,priority,due_date,due_at,course_id)
              values(p_user_id,v_item.title,'inbox','none',v_due,v_due_at,v_course) returning id into v_task;
            end if;
            -- Reminders and ordinary repeats cannot roll a known deadline back.
            if not v_new and (v_kind='deadline_changed' or (v_item.due_date is null and v_due is not null and v_time is not null)) then
              update public.tasks set due_date=v_due,due_at=v_due_at where id=v_task and user_id=p_user_id;
              update public.school_items set due_date=v_due,due_at=v_due_at,source_at=v_time where id=v_item.id;
            end if;
            update public.school_items set source_key=coalesce(source_key,v_source),source_url=coalesce(p_event->>'sourceUrl',source_url),
              weight=coalesce(weight,(p_event->>'weight')::numeric),task_id=v_task,task_created=task_created or v_task is not null
              where id=v_item.id;

            -- Persist successful mappings:
            -- Once an email has safely resolved to the user's Redline course,
            -- persist that external mapping using school_course_mappings.
            if p_event->>'courseHint' is not null then
              insert into public.school_course_mappings(user_id,source_course_key,course_id)
                values(p_user_id,p_event->>'courseHint',v_course) on conflict do nothing;
              insert into public.school_course_mappings(user_id,source_course_key,course_id)
                values(p_user_id,'name:'||public.school_normalize_key(p_event->>'courseHint'),v_course) on conflict do nothing;
            end if;
            if p_event->>'courseKey' is not null then
              insert into public.school_course_mappings(user_id,source_course_key,course_id)
                values(p_user_id,p_event->>'courseKey',v_course) on conflict do nothing;
            end if;
            if v_bb_course_id is not null and length(v_bb_course_id) > 0 then
              insert into public.school_course_mappings(user_id,source_course_key,course_id)
                values(p_user_id,v_bb_course_id,v_course) on conflict do nothing;
            end if;

            v_status:='processed';
          end if;
        end if;
      end if;
    end if;
  end if;
  update public.school_email_events set status=v_status,item_id=v_item.id,processed_at=now() where id=v_event.id;
  return jsonb_build_object('status',v_status,'eventId',v_event.id,'itemId',v_item.id,'taskId',(select task_id from public.school_items where id=v_item.id));
end;
$$;
revoke all on function public.ingest_school_email(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_school_email(uuid,jsonb) to service_role;
