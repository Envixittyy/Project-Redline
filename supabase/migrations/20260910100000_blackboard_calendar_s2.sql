-- Phase S2: Blackboard calendar current-state observations and canonical School reconciliation.
-- S1 email ingestion and its function body remain unchanged. This mutation path
-- deliberately takes the same per-owner advisory transaction lock.

alter table public.integration_accounts
  add column blackboard_sync_mode text not null default 'off'
    check (blackboard_sync_mode in ('off','observe','apply'));

alter table public.sync_runs
  add column sync_mode text check (sync_mode in ('observe','apply')),
  add column snapshot_complete boolean not null default false;

alter table public.external_records
  add column school_item_id uuid references public.school_items(id) on delete restrict,
  add column calendar_source_key text check (calendar_source_key is null or length(calendar_source_key) between 1 and 2000),
  add column calendar_course_key text check (calendar_course_key is null or length(calendar_course_key) between 1 and 500),
  add column calendar_source_revision text check (calendar_source_revision is null or length(calendar_source_revision) <= 500),
  add column school_applied_hash text check (school_applied_hash is null or school_applied_hash ~ '^[a-f0-9]{64}$');

create index external_records_owner_school_item_idx
  on public.external_records(user_id,school_item_id)
  where school_item_id is not null;

alter table public.sync_changes
  add column school_item_id uuid references public.school_items(id) on delete set null,
  add constraint sync_changes_details_s2_bounded
    check (jsonb_typeof(details)='object' and octet_length(details::text) <= 16000);

alter table public.sync_changes drop constraint sync_changes_type;
alter table public.sync_changes add constraint sync_changes_type check(change_type in(
  'created','updated','unchanged','missing','ambiguous','failed',
  'observed','proposed','applied','unresolved_course','unresolved_item','unresolved_task'
));

create index sync_changes_owner_school_item_idx
  on public.sync_changes(user_id,school_item_id,created_at desc)
  where school_item_id is not null;

create or replace function public.enforce_external_record_relationship_owner() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists (
    select 1 from public.integration_accounts account
    where account.id=new.account_id and account.user_id=new.user_id and account.provider=new.provider
  ) then
    raise exception 'account must belong to the external record owner/provider' using errcode='23503';
  end if;
  if new.course_id is not null and not exists (
    select 1 from public.courses course where course.id=new.course_id and course.user_id=new.user_id
  ) then
    raise exception 'course must belong to the external record owner' using errcode='23503';
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks task where task.id=new.task_id and task.user_id=new.user_id
  ) then
    raise exception 'task must belong to the external record owner' using errcode='23503';
  end if;
  if new.school_item_id is not null and not exists (
    select 1 from public.school_items item
    where item.id=new.school_item_id and item.user_id=new.user_id
      and (new.course_id is null or item.course_id=new.course_id)
  ) then
    raise exception 'School item must belong to the external record owner/course' using errcode='23503';
  end if;
  return new;
end;
$$;

create function public.enforce_blackboard_s2_audit_owner() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='sync_runs' then
    if not exists(select 1 from public.integration_accounts a where a.id=new.account_id and a.user_id=new.user_id) then
      raise exception 'sync account owner mismatch' using errcode='23503';
    end if;
  elsif tg_table_name='sync_changes' then
    if not exists(select 1 from public.sync_runs r where r.id=new.sync_run_id and r.user_id=new.user_id) then
      raise exception 'sync run owner mismatch' using errcode='23503';
    end if;
    if new.external_record_id is not null and not exists(select 1 from public.external_records e where e.id=new.external_record_id and e.user_id=new.user_id) then
      raise exception 'external record owner mismatch' using errcode='23503';
    end if;
    if new.school_item_id is not null and not exists(select 1 from public.school_items i where i.id=new.school_item_id and i.user_id=new.user_id) then
      raise exception 'School item audit owner mismatch' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger blackboard_s2_sync_runs_owner
  before insert or update on public.sync_runs
  for each row execute function public.enforce_blackboard_s2_audit_owner();
create trigger blackboard_s2_sync_changes_owner
  before insert or update on public.sync_changes
  for each row execute function public.enforce_blackboard_s2_audit_owner();

create function public.reconcile_blackboard_calendar_snapshot(
  p_user_id uuid,
  p_account_id uuid,
  p_run_id uuid,
  p_observations jsonb
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_account public.integration_accounts%rowtype;
  v_run public.sync_runs%rowtype;
  v_observation jsonb;
  v_record public.external_records%rowtype;
  v_item public.school_items%rowtype;
  v_course uuid;
  v_task uuid;
  v_candidates uuid[];
  v_uid text;
  v_title text;
  v_title_key text;
  v_description text;
  v_source_url text;
  v_source_key text;
  v_course_key text;
  v_course_code text;
  v_course_name text;
  v_type text;
  v_due date;
  v_due_at timestamptz;
  v_due_precision text;
  v_hash text;
  v_revision text;
  v_source_updated timestamptz;
  v_new_record boolean;
  v_changed boolean;
  v_outcome text;
  v_reason text;
  v_proposal jsonb;
  v_seen integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_missing integer := 0;
  v_unresolved integer := 0;
  v_applied integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if jsonb_typeof(p_observations) is distinct from 'array'
     or jsonb_array_length(p_observations)>2000
     or octet_length(p_observations::text)>2000000 then
    raise exception 'invalid Blackboard observation snapshot' using errcode='22023';
  end if;

  -- Exact S1 lock key. Do not change independently of ingest_school_email().
  perform pg_advisory_xact_lock(hashtextextended('school-email:'||p_user_id::text,0));
  select * into v_account from public.integration_accounts
    where id=p_account_id and user_id=p_user_id and provider='blackboard' for update;
  if not found or v_account.blackboard_sync_mode='off' then
    raise exception 'Blackboard calendar synchronization is off' using errcode='55000';
  end if;
  select * into v_run from public.sync_runs
    where id=p_run_id and user_id=p_user_id and account_id=p_account_id and status='running' for update;
  if not found or v_run.sync_mode is distinct from v_account.blackboard_sync_mode then
    raise exception 'Blackboard sync run is unavailable' using errcode='55000';
  end if;

  for v_observation in select value from jsonb_array_elements(p_observations) loop
    v_uid:=v_observation->>'uid';
    v_title:=v_observation->>'title';
    v_title_key:=v_observation->>'titleKey';
    v_description:=v_observation->>'description';
    v_source_url:=v_observation->>'sourceUrl';
    v_source_key:=v_observation->>'candidateSourceKey';
    v_course_key:=v_observation->>'candidateCourseKey';
    v_course_code:=v_observation->>'courseCode';
    v_course_name:=v_observation->>'courseName';
    v_type:=v_observation->>'itemType';
    v_due:=(v_observation->>'dueDate')::date;
    v_due_at:=(v_observation->>'dueAt')::timestamptz;
    v_due_precision:=v_observation->>'duePrecision';
    v_hash:=v_observation->>'contentHash';
    v_revision:=v_observation->>'sourceRevision';
    v_source_updated:=(v_observation->>'sourceUpdatedAt')::timestamptz;
    v_item:=null; v_course:=null; v_task:=null; v_candidates:=null;
    v_outcome:=null; v_reason:=null; v_proposal:='{}'::jsonb;
    if v_uid is null or length(v_uid) not between 1 and 2000
       or v_title is null or length(btrim(v_title)) not between 1 and 200
       or v_title_key is null or length(v_title_key) not between 1 and 300
       or v_type not in ('assignment','quiz','exam','unknown')
       or v_due_precision not in ('none','date','instant','unresolved')
       or v_hash !~ '^[a-f0-9]{64}$'
       or (v_due_at is not null and v_due is null)
       or (v_description is not null and length(v_description)>4000)
       or (v_source_url is not null and (length(v_source_url)>2000 or v_source_url not like 'https://%'))
       or (v_source_key is not null and length(v_source_key) not between 1 and 2000)
       or (v_course_key is not null and length(v_course_key) not between 1 and 500)
       or (v_revision is not null and length(v_revision)>500)
       or jsonb_typeof(coalesce(v_observation->'rawMetadata','{}'::jsonb))<>'object' then
      raise exception 'invalid Blackboard calendar observation' using errcode='22023';
    end if;

    select * into v_record from public.external_records
      where account_id=p_account_id and external_uid=v_uid for update;
    v_new_record:=not found;
    v_changed:=v_new_record or v_record.content_hash is distinct from v_hash;
    if v_new_record then
      insert into public.external_records(
        user_id,account_id,provider,external_uid,normalized_title,normalized_description,
        course_code,source_url,source_updated_at,due_at,due_date,due_precision,
        content_hash,last_seen_at,missing_since,raw_metadata,proposal_revision,
        calendar_source_key,calendar_course_key,calendar_source_revision
      ) values(
        p_user_id,p_account_id,'blackboard',v_uid,v_title,v_description,
        coalesce(v_course_code,v_course_name),v_source_url,v_source_updated,v_due_at,v_due,v_due_precision,
        v_hash,now(),null,coalesce(v_observation->'rawMetadata','{}'::jsonb),v_observation->>'proposalRevision',
        v_source_key,v_course_key,v_revision
      ) returning * into v_record;
      v_created:=v_created+1;
    elsif v_changed then
      update public.external_records set
        normalized_title=v_title,normalized_description=v_description,
        course_code=coalesce(v_course_code,v_course_name),source_url=v_source_url,
        source_updated_at=v_source_updated,due_at=v_due_at,due_date=v_due,due_precision=v_due_precision,
        content_hash=v_hash,last_seen_at=now(),missing_since=null,
        raw_metadata=coalesce(v_observation->'rawMetadata','{}'::jsonb),
        proposal_revision=v_observation->>'proposalRevision',calendar_source_key=v_source_key,
        calendar_course_key=v_course_key,calendar_source_revision=v_revision
      where id=v_record.id returning * into v_record;
      v_updated:=v_updated+1;
    else
      update public.external_records set last_seen_at=now(),missing_since=null
        where id=v_record.id returning * into v_record;
    end if;
    v_seen:=v_seen+1;

    -- S1 saved source keys have precedence, followed by the legacy exact manual
    -- mapping and then one exact normalized course code/name match.
    if v_course_key is not null then
      select m.course_id into v_course from public.school_course_mappings m
        join public.courses c on c.id=m.course_id and c.user_id=p_user_id and c.archived_at is null
        where m.user_id=p_user_id and m.source_course_key=v_course_key;
    end if;
    if v_course is null and coalesce(v_course_code,v_course_name) is not null then
      select m.course_id into v_course from public.blackboard_course_mappings m
        join public.courses c on c.id=m.course_id and c.user_id=p_user_id and c.archived_at is null
        where m.user_id=p_user_id and m.account_id=p_account_id
          and public.school_normalize_key(m.source_course_name)=public.school_normalize_key(coalesce(v_course_code,v_course_name));
    end if;
    if v_course is null and v_course_code is not null then
      select array_agg(id) into v_candidates from public.courses
        where user_id=p_user_id and archived_at is null
          and public.school_normalize_key(code)=public.school_normalize_key(v_course_code);
      if cardinality(v_candidates)=1 then v_course:=v_candidates[1]; end if;
    end if;
    if v_course is null and v_course_name is not null then
      select array_agg(id) into v_candidates from public.courses
        where user_id=p_user_id and archived_at is null
          and public.school_normalize_key(name)=public.school_normalize_key(v_course_name);
      if cardinality(v_candidates)=1 then v_course:=v_candidates[1]; end if;
    end if;
    update public.external_records set course_id=v_course where id=v_record.id;

    if v_course is null then
      v_outcome:='unresolved_course'; v_reason:='no_unique_course';
    elsif v_type not in ('assignment','quiz','exam') then
      v_outcome:='observed'; v_reason:=coalesce(v_observation->>'classificationReason','unsupported_type');
    else
      if v_record.school_item_id is not null then
        select * into v_item from public.school_items
          where id=v_record.school_item_id and user_id=p_user_id and course_id=v_course for update;
        if not found then v_outcome:='unresolved_item'; v_reason:='linked_item_owner_or_course_conflict'; end if;
      end if;
      if v_item.id is null and v_outcome is null and v_source_key is not null then
        select * into v_item from public.school_items
          where user_id=p_user_id and course_id=v_course and source_key=v_source_key for update;
      end if;
      if v_item.id is null and v_outcome is null then
        select array_agg(id) into v_candidates from public.school_items
          where user_id=p_user_id and course_id=v_course and title_key=v_title_key and item_type=v_type
            and (v_source_key is null or source_key is null);
        if cardinality(v_candidates)>0 then
          v_outcome:='unresolved_item'; v_reason:='compatible_title_without_shared_identity';
        end if;
      end if;
      if v_item.id is not null and v_item.item_type<>v_type then
        v_outcome:='unresolved_item'; v_reason:='item_type_conflict';
      end if;

      if v_outcome is null and v_item.id is null then
        v_proposal:=jsonb_build_object('action','create_school_item_and_task','courseId',v_course,'dueDate',v_due,'dueAt',v_due_at);
        if v_account.blackboard_sync_mode='observe' then
          v_outcome:='proposed'; v_reason:='observe_mode';
        else
          insert into public.school_items(
            user_id,course_id,item_type,title,title_key,source_key,source_url,due_date,due_at,source_at
          ) values(
            p_user_id,v_course,v_type,v_title,v_title_key,v_source_key,v_source_url,v_due,v_due_at,null
          ) returning * into v_item;
          insert into public.tasks(user_id,title,status,priority,due_date,due_at,course_id)
            values(p_user_id,v_title,'inbox','none',v_due,v_due_at,v_course) returning id into v_task;
          update public.school_items set task_id=v_task,task_created=true where id=v_item.id returning * into v_item;
          update public.external_records set school_item_id=v_item.id,school_applied_hash=v_hash where id=v_record.id;
          v_outcome:='applied'; v_reason:='created_from_current_state'; v_applied:=v_applied+1;
        end if;
      elsif v_outcome is null then
        update public.external_records set school_item_id=v_item.id where id=v_record.id;
        v_task:=v_item.task_id;
        if v_task is not null then
          perform 1 from public.tasks where id=v_task and user_id=p_user_id and course_id=v_course for update;
          if not found then v_outcome:='unresolved_task'; v_reason:='linked_task_owner_or_course_conflict'; end if;
        elsif v_item.task_created then
          v_outcome:='unresolved_task'; v_reason:='linked_task_was_deleted';
        else
          v_outcome:='unresolved_task'; v_reason:='actionable_item_has_no_task';
        end if;
        if v_outcome is null then
          v_proposal:=jsonb_build_object('action','update_deadline','schoolItemId',v_item.id,'taskId',v_task,'dueDate',v_due,'dueAt',v_due_at);
          if v_account.blackboard_sync_mode='observe' then
            v_outcome:='proposed'; v_reason:='observe_mode';
          elsif not v_changed then
            v_outcome:='unchanged'; v_reason:='identical_observation';
          elsif v_new_record and v_item.due_date is not null then
            -- First calendar sighting of an email-owned deadline is not allowed
            -- to roll it back. A later material calendar change can converge it.
            v_outcome:='observed'; v_reason:='first_calendar_observation_preserved_email_deadline';
          elsif v_due_precision not in ('date','instant') then
            v_outcome:='observed'; v_reason:='calendar_deadline_unresolved';
          else
            update public.tasks set due_date=v_due,due_at=v_due_at where id=v_task and user_id=p_user_id;
            update public.school_items set due_date=v_due,due_at=v_due_at,
              source_key=coalesce(source_key,v_source_key),source_url=coalesce(v_source_url,source_url)
              where id=v_item.id;
            update public.external_records set school_applied_hash=v_hash where id=v_record.id;
            v_outcome:='applied'; v_reason:='calendar_observation_advanced'; v_applied:=v_applied+1;
          end if;
        end if;
      end if;
    end if;

    if v_outcome in ('unresolved_course','unresolved_item','unresolved_task') then
      v_unresolved:=v_unresolved+1;
    end if;
    insert into public.sync_changes(
      user_id,sync_run_id,external_record_id,school_item_id,change_type,summary,details
    ) values(
      p_user_id,p_run_id,v_record.id,v_item.id,v_outcome,
      case when v_outcome='applied' then 'Blackboard current state applied to School'
           when v_outcome='proposed' then 'Blackboard current state observed; mutation withheld'
           when v_outcome like 'unresolved_%' then 'Blackboard current state requires review'
           else 'Blackboard current state observed' end,
      jsonb_build_object(
        'mode',v_account.blackboard_sync_mode,'reason',v_reason,'contentHash',v_hash,
        'courseId',v_course,'schoolItemId',v_item.id,'proposedMutation',v_proposal,
        'sourceChanged',v_changed
      )
    );
  end loop;

  -- Absence is recorded only inside this successful, complete-snapshot transaction.
  with newly_missing as (
    update public.external_records e set missing_since=coalesce(e.missing_since,now())
      where e.user_id=p_user_id and e.account_id=p_account_id and e.provider='blackboard'
        and not exists (
          select 1 from jsonb_array_elements(p_observations) o where o->>'uid'=e.external_uid
        )
        and e.missing_since is null
      returning e.id,e.school_item_id
  ), audit as (
    insert into public.sync_changes(user_id,sync_run_id,external_record_id,school_item_id,change_type,summary,details)
      select p_user_id,p_run_id,id,school_item_id,'missing','Blackboard calendar observation is no longer in the complete snapshot',
        jsonb_build_object('mode',v_account.blackboard_sync_mode,'reason','calendar_absence_is_not_deletion')
      from newly_missing
      returning 1
  ) select count(*) into v_missing from audit;

  update public.sync_runs set status='succeeded',completed_at=now(),snapshot_complete=true,
    seen_count=v_seen,created_count=v_created,updated_count=v_updated,missing_count=v_missing,error_code=null
    where id=p_run_id;
  update public.integration_accounts set sync_state='idle',last_success_at=now(),last_error_code=null
    where id=p_account_id;
  return jsonb_build_object(
    'seen',v_seen,'created',v_created,'updated',v_updated,'missing',v_missing,
    'unresolved',v_unresolved,'applied',v_applied,'mode',v_account.blackboard_sync_mode
  );
end;
$$;

revoke all on function public.reconcile_blackboard_calendar_snapshot(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_blackboard_calendar_snapshot(uuid,uuid,uuid,jsonb) to service_role;
