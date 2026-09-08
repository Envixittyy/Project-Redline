-- Final independent review of e122487: containment, NOT feature activation.
-- Preserve existing source/review/prediction data and owner reads. The preceding
-- repair's Apply RPCs lack canonical source freshness, strict reviewed contracts,
-- permission checks and calendar source-entry identity/divergence protection.
-- Revocation also protects existing valid reviews if application code is stale.
revoke all on function
  public.ai_create_scoped_request(text,text),
  public.ai_record_scoped_proposal(text,text),
  public.ai_revise_scoped_proposal(text,text),
  public.apply_ai_schedule_import(text,text),
  public.apply_ai_blackboard_courses(text,text),
  public.apply_ai_academic_calendar(text,text),
  public.apply_ai_assessment_predictions(text,text),
  public.confirm_prediction_to_task(text,text),
  public.confirm_prediction_to_event(text,text),
  public.apply_ai_note_rewrite(text,text),
  public.apply_ai_note_action_items(text,text),
  public.apply_ai_quick_capture(text,text)
from public, anon, authenticated;

-- A stored opt-in is never permission to activate an unreviewed capability.
create or replace function ai_private.cloud_allowed(p_capability text, p_provider text) returns boolean
language sql security definer set search_path='' as $$
  select coalesce((select cloud_enabled and cloud_fallback_mode<>'off' and
    (ai_mode=p_provider or (ai_mode='auto' and (preferred_cloud=p_provider or secondary_cloud))) and
    case p_capability
      when 'taskChecklist.propose' then checklist_cloud
      when 'courseImport.propose' then course_import_cloud
      else false
    end from public.ai_preferences where user_id=auth.uid()),false)
$$;
revoke all on function ai_private.cloud_allowed(text,text) from public,anon,authenticated;

-- Reject preparation/dispatch of both new and already prepared scoped attempts.
-- Delegate baseline checks to the unchanged two-argument Phase 10B function.
-- Remove the default third argument so two-argument calls are unambiguous.
drop function ai_private.inference_source(uuid,uuid,uuid);
create function ai_private.inference_source(p_checklist uuid, p_course uuid, p_scoped uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
begin
  if p_scoped is not null then raise exception 'school_intelligence_review_required'; end if;
  return ai_private.inference_source(p_checklist,p_course);
end $$;
revoke all on function ai_private.inference_source(uuid,uuid,uuid) from public,anon,authenticated;

-- A session GUC must not authorize prediction confirmation. Keep only the
-- quarantine's active->dismissed/superseded transitions; no terminal reopening.
create or replace function public.school_prediction_state_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'active' then raise exception 'Prediction must start active'; end if;
  elsif new.status is distinct from old.status and
    (old.status<>'active' or new.status not in ('dismissed','superseded')) then
    raise exception 'Prediction transition unavailable pending reviewed confirmation';
  end if;
  return new;
end $$;
revoke all on function public.school_prediction_state_guard() from public,anon,authenticated;

-- Complete the scoped FK owner boundary without granting any new write path.
create function public.ai_scoped_batch_owner_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.ai_scoped_request_id is not null and not exists (
    select 1 from public.ai_scoped_requests where id=new.ai_scoped_request_id and user_id=new.user_id
  ) then raise exception 'ai_owner_mismatch'; end if;
  return new;
end $$;
create trigger ai_scoped_batch_owner_check before insert or update on public.operation_batches
for each row execute function public.ai_scoped_batch_owner_guard();
revoke all on function public.ai_scoped_batch_owner_guard() from public,anon,authenticated;
