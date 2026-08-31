-- Security review: these rows have no signed source/review or atomic conversion
-- contract yet. Preserve owner reads and existing data, but deny client authority.
revoke all on public.school_assessment_predictions from public, anon, authenticated;
grant select on public.school_assessment_predictions to authenticated;

revoke all on function public.confirm_assessment_prediction(uuid) from public, anon, authenticated;
revoke all on function public.dismiss_assessment_prediction(uuid) from public, anon;

-- Dismissal is a narrow, non-converting action. Terminal states cannot be reopened.
create or replace function public.dismiss_assessment_prediction(p_prediction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  updated_count integer;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  update public.school_assessment_predictions set status = 'dismissed'
  where id = p_prediction_id and user_id = actor_id and status = 'active';
  get diagnostics updated_count = row_count;
  return jsonb_build_object('ok', updated_count > 0);
end;
$$;
grant execute on function public.dismiss_assessment_prediction(uuid) to authenticated;

-- Enforce owner equality for every FK, even for privileged maintenance writes.
create or replace function public.school_assessment_predictions_owner_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Prediction ownership is immutable';
  end if;
  if not exists (select 1 from public.courses where id = new.course_id and user_id = new.user_id) then
    raise exception 'Course must belong to the prediction owner';
  end if;
  if new.academic_calendar_id is not null and not exists (
    select 1 from public.calendar_events where id = new.academic_calendar_id and user_id = new.user_id
  ) then raise exception 'Calendar source must belong to the prediction owner'; end if;
  if new.syllabus_material_id is not null and not exists (
    select 1 from public.course_materials where id = new.syllabus_material_id
      and user_id = new.user_id and course_id = new.course_id
  ) then raise exception 'Syllabus must belong to the prediction owner and course'; end if;
  if new.blackboard_record_id is not null and not exists (
    select 1 from public.external_records where id = new.blackboard_record_id
      and user_id = new.user_id and course_id = new.course_id
  ) then raise exception 'Blackboard source must belong to the prediction owner and course'; end if;
  return new;
end;
$$;

create function public.school_prediction_state_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then raise exception 'Prediction must start active'; end if;
  elsif new.status is distinct from old.status and
    (old.status <> 'active' or new.status not in ('dismissed', 'superseded')) then
    raise exception 'Prediction transition unavailable pending reviewed confirmation';
  end if;
  return new;
end;
$$;
create trigger school_prediction_state_check
before insert or update on public.school_assessment_predictions
for each row execute function public.school_prediction_state_guard();
revoke all on function public.school_assessment_predictions_owner_guard(), public.school_prediction_state_guard() from public, anon, authenticated;
