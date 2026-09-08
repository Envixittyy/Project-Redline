-- Phase S1 explicitly replaces calendar ingestion with deterministic email ingestion.
-- No mailbox bodies, credentials, or calendar records are stored here.
create table public.school_course_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_course_key text not null check (length(source_course_key) between 1 and 500),
  course_id uuid not null references public.courses(id) on delete cascade,
  unique(user_id, source_course_key)
);

create table public.school_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  item_type text not null check(item_type in ('assignment','quiz','exam','material','announcement','course_opened')),
  title text not null check(length(btrim(title)) between 1 and 200),
  title_key text not null check(length(title_key) between 1 and 300),
  source_key text check(length(source_key) between 1 and 2000),
  source_url text check(length(source_url) <= 2000 and source_url like 'https://%'),
  due_date date, due_at timestamptz,
  weight numeric check(weight between 0 and 100),
  task_id uuid unique references public.tasks(id) on delete set null,
  task_created boolean not null default false,
  source_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(due_at is null or due_date is not null),
  unique(user_id, course_id, source_key)
);
create index school_items_course_activity on public.school_items(user_id,course_id,updated_at desc);
create index school_items_compound_identity on public.school_items(user_id,course_id,item_type,title_key);

create table public.school_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check(length(provider) between 1 and 40),
  provider_message_id text not null check(length(provider_message_id) between 1 and 300),
  message_key text not null check(message_key ~ '^[a-f0-9]{64}$'),
  parsed_event jsonb not null check(octet_length(parsed_event::text) <= 16000),
  status text not null check(status in ('received','processed','ignored','unknown_type','malformed','unresolved_course','unresolved_item','unresolved_task','stale')),
  item_id uuid references public.school_items(id) on delete restrict,
  received_at timestamptz not null,
  processed_at timestamptz,
  unique(user_id,provider,provider_message_id),
  unique(user_id,message_key)
);
create index school_email_events_review on public.school_email_events(user_id,status,received_at desc);

create function public.enforce_school_email_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name in ('school_items','school_course_mappings') then
    if not exists(select 1 from public.courses where id=new.course_id and user_id=new.user_id) then
      raise exception 'School course owner mismatch' using errcode='23503';
    end if;
  end if;
  if tg_table_name='school_items' then
    if new.task_id is not null and not exists(select 1 from public.tasks where id=new.task_id and user_id=new.user_id and course_id=new.course_id) then
      raise exception 'School task owner/course mismatch' using errcode='23503';
    end if;
  elsif tg_table_name='school_email_events' then
    if new.item_id is not null and not exists(select 1 from public.school_items where id=new.item_id and user_id=new.user_id) then
      raise exception 'School event owner mismatch' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$;
create trigger school_items_owner before insert or update on public.school_items for each row execute function public.enforce_school_email_owner();
create trigger school_mappings_owner before insert or update on public.school_course_mappings for each row execute function public.enforce_school_email_owner();
create trigger school_events_owner before insert or update on public.school_email_events for each row execute function public.enforce_school_email_owner();
create trigger school_items_updated before update on public.school_items for each row execute function public.set_updated_at();

alter table public.school_items enable row level security;
alter table public.school_email_events enable row level security;
alter table public.school_course_mappings enable row level security;
revoke all on public.school_items,public.school_email_events,public.school_course_mappings from anon,authenticated;
grant select on public.school_items,public.school_email_events,public.school_course_mappings to authenticated;
grant insert,update,delete on public.school_course_mappings to authenticated;
grant all on public.school_items,public.school_email_events,public.school_course_mappings to service_role;
create policy school_items_read on public.school_items for select to authenticated using(user_id=(select auth.uid()));
create policy school_events_read on public.school_email_events for select to authenticated using(user_id=(select auth.uid()));
create policy school_mappings_owner on public.school_course_mappings for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function public.school_normalize_key(value text) returns text language sql immutable set search_path='' as $$
  select lower(regexp_replace(btrim(normalize(value,NFKC)), '\s+', ' ', 'g'));
$$;

-- Only the verified inbound server may submit parsed events. Browser roles cannot
-- call this RPC, write the audit, or bypass parsing by claiming source=blackboard.
create function public.ingest_school_email(p_user_id uuid,p_event jsonb) returns jsonb
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
    -- A saved external course identifier has precedence over all display text.
    select course_id into v_course from public.school_course_mappings m join public.courses c on c.id=m.course_id
      where m.user_id=p_user_id and c.archived_at is null and m.source_course_key=p_event->>'courseKey';
    if v_course is null then
      select array_agg(id) into v_candidates from public.courses where user_id=p_user_id and archived_at is null
        and public.school_normalize_key(code)=public.school_normalize_key(p_event->>'courseHint');
      if cardinality(v_candidates)=1 then v_course:=v_candidates[1];
      elsif coalesce(cardinality(v_candidates),0)=0 then
        select array_agg(id) into v_candidates from public.courses where user_id=p_user_id and archived_at is null
          and public.school_normalize_key(name)=public.school_normalize_key(p_event->>'courseHint');
        if cardinality(v_candidates)=1 then v_course:=v_candidates[1]; end if;
      end if;
    end if;
    if v_course is null then v_status:='unresolved_course';
    else
      if v_source is not null then
        select * into v_item from public.school_items where user_id=p_user_id and course_id=v_course and source_key=v_source for update;
      end if;
      if v_item.id is null then
        select array_agg(id) into v_candidates from public.school_items
          where user_id=p_user_id and course_id=v_course and title_key=p_event->>'titleKey'
          and (item_type=v_type or (v_type='unknown' and v_kind in ('deadline_changed','reminder') and item_type in ('assignment','quiz','exam')))
          and (v_source is null or source_key is null);
        if cardinality(v_candidates)=1 then
          select * into v_item from public.school_items where id=v_candidates[1] for update;
        elsif cardinality(v_candidates)>1 then v_status:='unresolved_item'; end if;
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
            if p_event->>'courseKey' is not null then
              insert into public.school_course_mappings(user_id,source_course_key,course_id) values(p_user_id,p_event->>'courseKey',v_course) on conflict do nothing;
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

-- Authenticated retry is ID-only: no arbitrary browser-authored School events.
create function public.retry_school_email_event(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event public.school_email_events%rowtype;
begin
  select * into v_event from public.school_email_events where id=p_id and user_id=auth.uid();
  if not found then raise exception 'School event unavailable' using errcode='42501'; end if;
  return public.ingest_school_email(v_event.user_id,v_event.parsed_event);
end;
$$;
revoke all on function public.retry_school_email_event(uuid) from public,anon;
grant execute on function public.retry_school_email_event(uuid) to authenticated;
