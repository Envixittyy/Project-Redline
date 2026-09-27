-- Phase S1/S2: Reconcile Blackboard Calendar S2 and Email Ingestion End-to-End
-- 1. Helper function for course code normalization (handling spaces/hyphens like 'CPE 123' vs 'CPE123').
-- 2. Enhanced course matching: CPE 123, CPE123, CPE 123 - Computer Engineering, Computer Engineering 123.
-- 3. Calendar S2 and Email reconciliation: shared item IDs, external_records task links, and semantic fallback.
-- 4. Automatic course material mirroring to course_materials when new material arrives.

create or replace function public.school_normalize_code(value text) returns text
language sql immutable set search_path='' as $$
  select nullif(lower(regexp_replace(btrim(normalize(coalesce(value, ''), NFKC)), '[^A-Za-z0-9]', '', 'g')), '');
$$;
grant execute on function public.school_normalize_code(text) to authenticated, service_role;

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
  v_candidate_item public.school_items%rowtype;
  v_course uuid;
  v_candidates uuid[];
  v_task uuid;
  v_status text;
  v_type text := p_event->>'itemType';
  v_kind text := p_event->>'notificationType';
  v_source text := p_event->>'sourceKey';
  v_time timestamptz := (p_event->>'sourceAt')::timestamptz;
  v_due date := (p_event->>'dueDate')::date;
  v_due_at timestamptz := (p_event->>'dueAt')::timestamptz;
  v_title text := p_event->>'title';
  v_title_key text := p_event->>'titleKey';
  v_course_hint text := p_event->>'courseHint';
  v_course_key text := p_event->>'courseKey';
  v_source_url text := p_event->>'sourceUrl';
  v_weight numeric := (p_event->>'weight')::numeric;
  v_new boolean := false;
  v_base_code text;
  v_bb_course_id text;
  v_bb_item_id text;
begin
  if p_event->>'source' is distinct from 'blackboard' or p_event->>'parserVersion' is distinct from 'blackboard-email-v1'
     or p_event->>'status' not in ('parsed','ignored','unknown_type','malformed','needs_review') then
    raise exception 'Invalid School event' using errcode='22023';
  end if;

  -- Single-user ingestion lock covers different messages, mapping resolution,
  -- logical identity promotion and task creation in the same transaction.
  perform pg_advisory_xact_lock(hashtextextended('school-email:'||p_user_id::text,0));
  select * into v_event from public.school_email_events where user_id=p_user_id and
    (message_key=p_event->>'messageKey' or (provider=p_event->>'provider' and provider_message_id=p_event->>'sourceMessageId')) limit 1 for update;
  if found then
    -- If event already succeeded or was definitively ignored/stale, short-circuit idempotently
    if v_event.status not in ('unresolved_course','unresolved_item','unresolved_task','needs_review','malformed','unknown_type','failed') then
      return jsonb_build_object('status','duplicate','eventId',v_event.id,'itemId',v_event.item_id,'taskId',(select task_id from public.school_items where id=v_event.item_id));
    end if;
    -- Retries use immutable stored evidence, never replacement caller fields.
    p_event := v_event.parsed_event;
    v_type := p_event->>'itemType';
    v_kind := p_event->>'notificationType';
    v_source := p_event->>'sourceKey';
    v_time := (p_event->>'sourceAt')::timestamptz;
    v_due := (p_event->>'dueDate')::date;
    v_due_at := (p_event->>'dueAt')::timestamptz;
    v_title := p_event->>'title';
    v_title_key := p_event->>'titleKey';
    v_course_hint := p_event->>'courseHint';
    v_course_key := p_event->>'courseKey';
    v_source_url := p_event->>'sourceUrl';
    v_weight := (p_event->>'weight')::numeric;
  else
    insert into public.school_email_events(user_id,provider,provider_message_id,message_key,parsed_event,status,received_at)
    values(p_user_id,p_event->>'provider',p_event->>'sourceMessageId',p_event->>'messageKey',p_event,'received',(p_event->>'receivedAt')::timestamptz) returning * into v_event;
  end if;

  v_status := p_event->>'status';
  if v_status='parsed' then
    -- Extract Blackboard course ID from courseKey (e.g. 'learn.example.edu:_165958_1' -> '_165958_1')
    if v_course_key is not null and position(':' in v_course_key) > 0 then
      v_bb_course_id := split_part(v_course_key, ':', 2);
    else
      v_bb_course_id := null;
    end if;

    -- Extract Blackboard item ID from sourceKey (e.g. 'learn.example.edu:content_id:_201_1' -> '_201_1')
    if v_source is not null and position(':' in v_source) > 0 then
      v_bb_item_id := split_part(v_source, ':', 3);
      if v_bb_item_id is null or length(v_bb_item_id) = 0 then
        v_bb_item_id := split_part(v_source, ':', 2);
      end if;
    else
      v_bb_item_id := null;
    end if;

    -- Course resolution priority:
    -- 1. Existing explicit school_course_mappings mapping
    if v_course is null and v_course_hint is not null then
      select m.course_id into v_course
        from public.school_course_mappings m
        join public.courses c on c.id = m.course_id
        where m.user_id = p_user_id
          and c.archived_at is null
          and (
            m.source_course_key = v_course_hint
            or public.school_normalize_key(m.source_course_key) = public.school_normalize_key(v_course_hint)
            or m.source_course_key = 'name:' || public.school_normalize_key(v_course_hint)
            or public.school_normalize_code(m.source_course_key) = public.school_normalize_code(v_course_hint)
          )
        limit 1;
    end if;

    -- 2. Existing strong Blackboard courseId mapping
    if v_course is null and (v_course_key is not null or v_bb_course_id is not null) then
      select m.course_id into v_course
        from public.school_course_mappings m
        join public.courses c on c.id = m.course_id
        where m.user_id = p_user_id
          and c.archived_at is null
          and (
            (v_course_key is not null and m.source_course_key = v_course_key)
            or (v_bb_course_id is not null and m.source_course_key = v_bb_course_id)
            or (v_bb_course_id is not null and public.school_normalize_key(m.source_course_key) = public.school_normalize_key(v_bb_course_id))
          )
        limit 1;
    end if;

    -- 3. Exact unique match of the extracted baseCourseCode against courses.code
    v_base_code := coalesce(
      p_event->>'baseCourseCode',
      public.school_extract_base_course_code(v_course_hint)
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
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 4. Code match with normalized code (handles CPE 123 vs CPE123, CPE-123)
    if v_course is null and v_status = 'parsed' and v_course_hint is not null then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and (
            public.school_normalize_key(code) = public.school_normalize_key(v_course_hint)
            or public.school_normalize_code(code) = public.school_normalize_code(v_course_hint)
          );
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      elsif cardinality(v_candidates) > 1 then
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 5. Code prefix match when courseHint contains a separator (e.g. "CPE 123 - Computer Engineering" -> code "CPE 123")
    if v_course is null and v_status = 'parsed' and v_course_hint is not null and (
      v_course_hint like '%-%' or v_course_hint like '%:%' or v_course_hint like '%–%' or v_course_hint like '%—%'
    ) then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and (
            public.school_normalize_code(code) = public.school_normalize_code(split_part(split_part(split_part(split_part(v_course_hint, '—', 1), '–', 1), ':', 1), '-', 1))
          );
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      elsif cardinality(v_candidates) > 1 then
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 6. Exact normalized course-name matching as fallback against courses.name
    if v_course is null and v_status = 'parsed' and v_course_hint is not null then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and (
            public.school_normalize_key(name) = public.school_normalize_key(v_course_hint)
            or (
              (v_course_hint like '%-%' or v_course_hint like '%:%' or v_course_hint like '%–%' or v_course_hint like '%—%')
              and public.school_normalize_key(name) = public.school_normalize_key(split_part(split_part(split_part(split_part(v_course_hint, '—', 2), '–', 2), ':', 2), '-', 2))
            )
            or (
              -- e.g. "Computer Engineering 123" matching name "Computer Engineering"
              public.school_normalize_key(name) = public.school_normalize_key(regexp_replace(v_course_hint, '\s+\d+[A-Za-z0-9]*$', ''))
            )
          );
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      elsif cardinality(v_candidates) > 1 then
        v_status := 'unresolved_course';
      end if;
    end if;

    -- 7. Implied course from title prefix (e.g. courseHint null, but title is "Ethics Activity 4" and course name is "Ethics")
    if v_course is null and v_status = 'parsed' and v_title is not null then
      select array_agg(id) into v_candidates
        from public.courses
        where user_id = p_user_id
          and archived_at is null
          and (
            public.school_normalize_key(v_title) like public.school_normalize_key(name) || ' %'
            or public.school_normalize_code(code) = public.school_normalize_code(split_part(v_title, ' ', 1))
          );
      if cardinality(v_candidates) = 1 then
        v_course := v_candidates[1];
      end if;
    end if;

    -- If still unresolved, fail closed to unresolved_course
    if v_course is null then
      v_status := 'unresolved_course';
    else
      -- 1. Direct match on source_key
      if v_source is not null then
        select * into v_item from public.school_items
          where user_id=p_user_id and course_id=v_course and source_key=v_source for update;
      end if;

      -- 2. Item identifier match (if sourceKey contains an item ID like _201_1 or _301_1)
      if v_item.id is null and v_bb_item_id is not null and length(v_bb_item_id) > 1 then
        select * into v_item from public.school_items
          where user_id=p_user_id and course_id=v_course
            and (
              source_key like '%:' || v_bb_item_id
              or source_key = v_bb_item_id
              or (source_url is not null and source_url like '%' || v_bb_item_id || '%')
            )
          limit 1 for update;
      end if;

      -- 3. External records reconciliation (Calendar S2 / Proposal record link)
      if v_item.id is null then
        select i.* into v_item from public.school_items i
          join public.external_records e on e.task_id = i.task_id and e.user_id = p_user_id and e.provider = 'blackboard'
          where i.user_id = p_user_id and i.course_id = v_course
            and (
              (v_source is not null and e.external_uid = v_source)
              or (v_bb_item_id is not null and e.external_uid like '%' || v_bb_item_id || '%')
              or (v_source_url is not null and e.source_url = v_source_url)
            )
          limit 1 for update;
      end if;

      -- 4. Calendar S2 Semantic Reconciliation:
      -- When an email arrives for an item previously created from Calendar S2 (which has a calendar UID or task link),
      -- match by normalized title and compatible type IF:
      --   a) It is a deadline change or reminder, OR
      --   b) Both have matching non-null due dates.
      if v_item.id is null then
        select array_agg(id) into v_candidates from public.school_items
          where user_id = p_user_id and course_id = v_course
            and (
              title_key = v_title_key
              or (v_title is not null and title_key = public.school_normalize_key(regexp_replace(v_title, '^(?:[A-Za-z0-9 _-]+\s*[:\-–—]\s*)+', '')))
              or (v_title_key is not null and public.school_normalize_key(regexp_replace(title, '^(?:[A-Za-z0-9 _-]+\s*[:\-–—]\s*)+', '')) = v_title_key)
              or (
                v_title_key is not null and (
                  public.school_normalize_key(title) like '% ' || v_title_key
                  or v_title_key like '% ' || public.school_normalize_key(title)
                )
              )
            )
            and (
              item_type = v_type
              or (v_type = 'unknown' and (v_kind in ('deadline_changed', 'reminder', 'grade_updated') or item_type in ('assignment', 'quiz', 'exam')))
              or (v_type in ('assignment', 'quiz', 'exam') and item_type in ('assignment', 'quiz', 'exam'))
            );

        if cardinality(v_candidates) = 1 then
          select * into v_candidate_item from public.school_items where id = v_candidates[1] for update;
          -- Two distinct strong email items with different content IDs must never merge.
          if (v_bb_item_id is not null and v_candidate_item.source_key is not null and v_candidate_item.source_key like '%_id:%'
              and not (v_candidate_item.source_key like '%:' || v_bb_item_id)) then
            -- Distinct strong IDs: do not merge
            null;
          elsif v_kind in ('deadline_changed', 'reminder')
             or (v_due is not null and v_candidate_item.due_date is not null and v_due = v_candidate_item.due_date) then
            v_item := v_candidate_item;
          end if;
        end if;
      end if;

      if v_kind = 'submission_received' then
        if v_item.id is null then
          v_status := 'unresolved_item';
        elsif v_item.item_type not in ('assignment', 'quiz', 'exam') then
          v_status := 'unresolved_item';
        elsif v_type <> 'unknown' and v_type <> v_item.item_type then
          v_status := 'unresolved_item';
        else
          v_task := v_item.task_id;
          if v_task is null then
            v_status := 'unresolved_task';
          else
            perform 1 from public.tasks where id=v_task and user_id=p_user_id and course_id=v_course for update;
            if not found then
              v_status := 'unresolved_task';
            else
              update public.tasks set status='submitted', updated_at=now() where id=v_task and user_id=p_user_id;
              if v_time is not null and (v_item.source_at is null or v_time > v_item.source_at) then
                update public.school_items set source_at=v_time, updated_at=now() where id=v_item.id;
              end if;
              v_status := 'processed';
            end if;
          end if;
        end if;

      elsif v_kind = 'grade_updated' then
        if v_item.id is null then
          v_status := 'unresolved_item';
        elsif v_type <> 'unknown' and v_type <> v_item.item_type then
          v_status := 'unresolved_item';
        else
          if v_time is not null and (v_item.source_at is null or v_time > v_item.source_at) then
            update public.school_items set source_at=v_time, updated_at=now() where id=v_item.id;
          end if;
          v_status := 'processed';
        end if;

      else
        -- Standard item creation, deadline_changed, reminder, etc.
        -- When either side lacks a strong source key and they did not reconcile above,
        -- check for ambiguous same-title course work to fail closed safely.
        if v_item.id is null then
          select array_agg(id) into v_candidates from public.school_items
            where user_id=p_user_id and course_id=v_course and title_key=v_title_key
            and (item_type=v_type or (v_type='unknown' and v_kind in ('deadline_changed','reminder') and item_type in ('assignment','quiz','exam')))
            and (v_source is null or source_key is null);
          if cardinality(v_candidates)>0 then
            v_status:='unresolved_item';
          end if;
        end if;

        if v_item.id is not null and v_type<>'unknown' and v_type<>v_item.item_type
           and not (v_type in ('assignment','quiz','exam') and v_item.item_type in ('assignment','quiz','exam')) then
          v_status := 'unresolved_item';
        end if;
        if v_item.id is null and (v_kind in ('deadline_changed','reminder') or v_type='unknown') then
          v_status := 'unresolved_item';
        end if;
        if v_status='parsed' and v_item.id is null then
          insert into public.school_items(user_id,course_id,item_type,title,title_key,source_key,source_url,due_date,due_at,weight,source_at)
          values(p_user_id,v_course,v_type,v_title,v_title_key,v_source,v_source_url,v_due,v_due_at,v_weight,v_time)
          returning * into v_item;
          v_new := true;
        end if;
        if v_status='parsed' then
          if not v_new and v_time is not null and v_item.source_at is not null and v_time<v_item.source_at then
            v_status := 'stale';
          elsif not v_new and v_kind='deadline_changed' and v_time=v_item.source_at and (v_item.due_date is distinct from v_due or v_item.due_at is distinct from v_due_at) then
            v_status := 'unresolved_item';
          else
            v_task := v_item.task_id;
            if v_task is not null then
              perform 1 from public.tasks where id=v_task and user_id=p_user_id and course_id=v_course for update;
              if not found then v_status := 'unresolved_task'; end if;
            elsif v_item.task_created then
              v_status := 'unresolved_task'; -- Never recreate a user-deleted Task.
            end if;

            if v_status='parsed' then
              -- Create task for assignment/quiz/exam OR actionable announcement/material with explicit deadline
              if v_new and (v_type in ('assignment','quiz','exam') or (v_type in ('announcement','material') and v_due is not null)) then
                insert into public.tasks(user_id,title,status,priority,due_date,due_at,course_id)
                values(p_user_id,v_item.title,'inbox','none',v_due,v_due_at,v_course) returning id into v_task;
              end if;

              -- Reminders and ordinary repeats cannot roll a known deadline back.
              if not v_new and (v_kind='deadline_changed' or (v_item.due_date is null and v_due is not null and v_time is not null)) then
                if v_task is not null then
                  update public.tasks set due_date=v_due,due_at=v_due_at where id=v_task and user_id=p_user_id;
                end if;
                update public.school_items set due_date=v_due,due_at=v_due_at,source_at=coalesce(v_time,source_at) where id=v_item.id;
              end if;

              update public.school_items set
                source_key=coalesce(source_key,v_source),
                source_url=coalesce(v_source_url,source_url),
                weight=coalesce(weight,v_weight),
                task_id=coalesce(task_id,v_task),
                task_created=task_created or v_task is not null
                where id=v_item.id;

              -- Mirror new materials to course_materials table without creating tasks
              if v_item.item_type = 'material' and not exists (
                select 1 from public.course_materials where user_id=p_user_id and course_id=v_course and title=v_item.title
              ) then
                insert into public.course_materials(user_id,course_id,title,type,url)
                values(p_user_id,v_course,v_item.title,'document',v_item.source_url);
              end if;

              v_status := 'processed';
            end if;
          end if;
        end if;
      end if;

      if v_status = 'processed' then
        -- Persist successful mappings for fast future resolution
        if v_course_hint is not null then
          insert into public.school_course_mappings(user_id,source_course_key,course_id)
            values(p_user_id,v_course_hint,v_course) on conflict do nothing;
          insert into public.school_course_mappings(user_id,source_course_key,course_id)
            values(p_user_id,'name:'||public.school_normalize_key(v_course_hint),v_course) on conflict do nothing;
        end if;
        if v_course_key is not null then
          insert into public.school_course_mappings(user_id,source_course_key,course_id)
            values(p_user_id,v_course_key,v_course) on conflict do nothing;
        end if;
        if v_bb_course_id is not null and length(v_bb_course_id) > 0 then
          insert into public.school_course_mappings(user_id,source_course_key,course_id)
            values(p_user_id,v_bb_course_id,v_course) on conflict do nothing;
        end if;
        if v_base_code is not null and length(v_base_code) > 0 then
          insert into public.school_course_mappings(user_id,source_course_key,course_id)
            values(p_user_id,v_base_code,v_course) on conflict do nothing;
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
