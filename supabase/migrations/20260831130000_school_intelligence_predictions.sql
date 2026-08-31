-- Migration: School Intelligence, Assessment Predictions & Academic Calendar Source
-- Phase: School Intelligence Platform

-- 1. Add academic_calendar to calendar_event_source enum if not present
alter type calendar_event_source add value if not exists 'academic_calendar';

-- 2. Create school_assessment_predictions table
create table if not exists public.school_assessment_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  prediction_type text not null check (prediction_type in ('quiz', 'exam', 'assignment', 'project', 'milestone', 'other')),
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  predicted_date date not null,
  predicted_time text check (predicted_time is null or predicted_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  confidence text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  status text not null default 'active' check (status in ('active', 'dismissed', 'confirmed', 'superseded')),
  rationale text not null check (btrim(rationale) <> '' and char_length(rationale) <= 2000),
  source_reference text check (source_reference is null or char_length(source_reference) <= 500),
  academic_calendar_id uuid references public.calendar_events(id) on delete set null,
  syllabus_material_id uuid references public.course_materials(id) on delete set null,
  blackboard_record_id uuid references public.external_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for prediction query paths
create index if not exists school_assessment_predictions_user_date_idx
  on public.school_assessment_predictions (user_id, status, predicted_date);

create index if not exists school_assessment_predictions_course_idx
  on public.school_assessment_predictions (user_id, course_id, status);

-- Trigger for updated_at
create trigger school_assessment_predictions_updated
  before update on public.school_assessment_predictions
  for each row execute function public.set_updated_at();

-- Owner consistency guard trigger
create or replace function public.school_assessment_predictions_owner_guard()
returns trigger
language plpgsql
security invoker
as $$
declare
  course_owner uuid;
begin
  select user_id into course_owner from public.courses where id = new.course_id;
  if course_owner is null or course_owner <> new.user_id then
    raise exception 'Course must belong to the prediction owner';
  end if;
  return new;
end;
$$;

create trigger school_assessment_predictions_owner_check
  before insert or update on public.school_assessment_predictions
  for each row execute function public.school_assessment_predictions_owner_guard();

-- 3. Row Level Security policies
alter table public.school_assessment_predictions enable row level security;

create policy school_assessment_predictions_select_own on public.school_assessment_predictions
  for select to authenticated using ((select auth.uid()) = user_id);

create policy school_assessment_predictions_insert_own on public.school_assessment_predictions
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy school_assessment_predictions_update_own on public.school_assessment_predictions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy school_assessment_predictions_delete_own on public.school_assessment_predictions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 4. Helper RPCs for Prediction Lifecycle Management

create or replace function public.dismiss_assessment_prediction(p_prediction_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  updated_count integer;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.school_assessment_predictions
  set status = 'dismissed'
  where id = p_prediction_id and user_id = actor_id and status = 'active';

  get diagnostics updated_count = row_count;
  return jsonb_build_object('ok', updated_count > 0, 'prediction_id', p_prediction_id);
end;
$$;

create or replace function public.confirm_assessment_prediction(p_prediction_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  updated_count integer;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.school_assessment_predictions
  set status = 'confirmed'
  where id = p_prediction_id and user_id = actor_id and status = 'active';

  get diagnostics updated_count = row_count;
  return jsonb_build_object('ok', updated_count > 0, 'prediction_id', p_prediction_id);
end;
$$;

grant execute on function public.dismiss_assessment_prediction(uuid) to authenticated;
grant execute on function public.confirm_assessment_prediction(uuid) to authenticated;
