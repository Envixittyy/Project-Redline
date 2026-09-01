import "server-only";
import { randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { getAiPreferences } from "./ai-repository";
import { prepareTaskChecklist, finalizeTaskChecklist } from "./checklist-repository";
import { prepareCourseImport, finalizeCourseImport } from "./course-import-repository";
import { cloudAvailability, cloudModel, CLOUD_PRIVACY_URLS, inferCloud } from "./cloud-provider";
import { readInferenceSource } from "./inference-source";
import { signAiCommand } from "./trust-signing";
import { AiTrustError, uuid } from "./trust-contract";
import {
  capabilityFor, cloudAllowed, isCloud, localSelection, mayFallback, routingChain,
  type InferenceLocation, type InferenceProvider, type InferenceProvenance, type RequestKind,
  type RoutedPreparation, type RoutingPreferences,
} from "./routing-contract";

import { prepareScheduleImport, finalizeScheduleImport } from "./schedule-import-repository";
import { prepareBlackboardScreenshotImport, finalizeBlackboardScreenshotImport } from "./blackboard-screenshot-repository";
import { prepareAcademicCalendarImport, finalizeAcademicCalendarImport } from "./academic-calendar-repository";
import { prepareAssessmentPredictions, finalizeAssessmentPredictions } from "./assessment-prediction-repository";
import { prepareNoteIntelligence, finalizeNoteIntelligence } from "./note-intelligence-repository";
import { prepareQuickCapture, finalizeQuickCapture } from "./quick-capture-repository";
import { prepareDailyPlanAdvice, finalizeDailyPlanAdvice } from "./daily-plan-repository";
import { prepareCourseMaterialIntelligence, finalizeCourseMaterialIntelligence } from "./course-material-intelligence-repository";
import { prepareContextualAssistant, finalizeContextualAssistant } from "./contextual-assistant-repository";

import { SCHEDULE_IMAGE_CAPABILITY } from "./school-schedule-contract";
import { BLACKBOARD_COURSE_IMAGE_CAPABILITY } from "./blackboard-screenshot-contract";
import { ACADEMIC_CALENDAR_CAPABILITY } from "./academic-calendar-contract";
import { ASSESSMENT_PREDICTION_CAPABILITY } from "./assessment-prediction-contract";
import {
  NOTE_SUMMARY_CAPABILITY,
  NOTE_REWRITE_CAPABILITY,
  NOTE_ACTION_ITEMS_CAPABILITY,
} from "./note-intelligence-contract";
import { QUICK_CAPTURE_CAPABILITY } from "./quick-capture-contract";
import { DAILY_PLAN_ADVICE_CAPABILITY } from "./daily-plan-contract";
import {
  COURSE_MATERIAL_SUMMARY_CAPABILITY,
  COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY,
} from "./course-material-intelligence-contract";
import { CONTEXTUAL_ASSISTANT_CAPABILITY } from "./contextual-assistant-contract";

export async function routingPreferences(): Promise<RoutingPreferences> {
  const p = await getAiPreferences();
  return {
    aiMode: p.aiMode ?? "auto",
    preferredCloud: p.preferredCloud ?? "gemini",
    secondaryCloud: p.secondaryCloud ?? false,
    checklistCloud: p.checklistCloud ?? false,
    courseImportCloud: p.courseImportCloud ?? false,
    schoolScheduleCloud: p.schoolScheduleCloud ?? false,
    blackboardCourseCloud: p.blackboardCourseCloud ?? false,
    academicCalendarCloud: p.academicCalendarCloud ?? false,
    assessmentPredictionCloud: p.assessmentPredictionCloud ?? false,
    notesCloud: p.notesCloud ?? false,
    quickCaptureCloud: p.quickCaptureCloud ?? false,
    dailyPlanCloud: p.dailyPlanCloud ?? false,
    courseMaterialCloud: p.courseMaterialCloud ?? false,
    contextualAssistantCloud: p.contextualAssistantCloud ?? false,
    cloudEnabled: p.cloudEnabled,
    cloudFallbackMode: p.cloudFallbackMode,
  };
}
async function rpc(operation: string, data: Record<string, unknown>) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(`ai_${operation}`, signAiCommand(userId, operation, data));
  if (result.error) throw new AiTrustError("request_unavailable");
  return result.data;
}
type Attempt = {
  id: string;
  checklist_request_id: string | null;
  course_request_id: string | null;
  scoped_request_id: string | null;
  provider: InferenceProvider;
  model: string;
  location: InferenceLocation;
  capability: string;
  payload_digest: string;
  status: string;
  error_code: string | null;
  expires_at: string;
};
export async function loadInferenceAttempt(id: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("ai_inference_attempts")
    .select("id,checklist_request_id,course_request_id,scoped_request_id,provider,model,location,capability,payload_digest,status,error_code,expires_at")
    .eq("id", uuid(id)).eq("user_id", userId).maybeSingle();
  if (error || !data || Date.parse(data.expires_at) <= Date.now()) throw new AiTrustError("request_unavailable");
  const a = data as Attempt;
  const kind: RequestKind = a.checklist_request_id
    ? "checklist"
    : a.capability === SCHEDULE_IMAGE_CAPABILITY.id
    ? "schedule_image"
    : a.capability === BLACKBOARD_COURSE_IMAGE_CAPABILITY.id
    ? "blackboard_image"
    : a.capability === ACADEMIC_CALENDAR_CAPABILITY.id
    ? "academic_calendar"
    : a.capability === ASSESSMENT_PREDICTION_CAPABILITY.id
    ? "assessment_prediction"
    : a.capability === NOTE_SUMMARY_CAPABILITY.id
    ? "note_summary"
    : a.capability === NOTE_REWRITE_CAPABILITY.id
    ? "note_rewrite"
    : a.capability === NOTE_ACTION_ITEMS_CAPABILITY.id
    ? "note_action_items"
    : a.capability === QUICK_CAPTURE_CAPABILITY.id
    ? "quick_capture"
    : a.capability === DAILY_PLAN_ADVICE_CAPABILITY.id
    ? "daily_plan_advice"
    : a.capability === COURSE_MATERIAL_SUMMARY_CAPABILITY.id
    ? "material_summary"
    : a.capability === COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id
    ? "material_study_questions"
    : a.capability === CONTEXTUAL_ASSISTANT_CAPABILITY.id
    ? "contextual_assistant"
    : "course";
  if (a.capability !== capabilityFor(kind).id) throw new AiTrustError("capability_denied");
  return { ...a, kind, requestId: (a.checklist_request_id ?? a.course_request_id ?? a.scoped_request_id)! };
}
async function prepareAttempt(kind: RequestKind, requestId: string, provider: InferenceProvider, model: string, location: InferenceLocation, parentId?: string): Promise<RoutedPreparation> {
  const source = await readInferenceSource(kind, requestId, model);
  const id = randomUUID(), capability = capabilityFor(kind);
  await rpc("prepare_inference", {
    id,
    checklist_request_id: kind === "checklist" ? requestId : null,
    course_request_id: kind === "course" ? requestId : null,
    scoped_request_id: (kind !== "checklist" && kind !== "course") ? requestId : null,
    parent_id: parentId ?? null,
    provider,
    model,
    location,
    capability: capability.id,
    payload_digest: source.digest,
    text_bytes: source.bytes,
  });
  return { attemptId: id, requestId, kind, provider, model, location,
    ...(location !== "cloud" ? { inference: source.inference } : {}),
    disclosure: { purpose: capability.id, fields: [...capability.inputFields], sources: 1, bytes: source.bytes, expiresAt: source.expiresAt,
      ...(isCloud(provider) ? { privacyUrl: CLOUD_PRIVACY_URLS[provider] } : {}) } };
}
export async function prepareRoutedInference(kind: RequestKind, input: unknown, local: unknown) {
  await requireAuthenticatedSupabase();
  const prefs = await routingPreferences();
  const selected = localSelection(local);
  const first = routingChain(prefs, capabilityFor(kind).id)[0];
  const provider = first === "local" ? selected?.provider ?? "ollama" : first;
  const model = first === "local" ? selected?.model ?? "unconfigured" : cloudAvailability(first).model ?? "unconfigured";
  const location = first === "local" ? selected?.location ?? "local" : "cloud";
  const prepared =
    kind === "checklist"
      ? await prepareTaskChecklist(input, provider, model)
      : kind === "course"
      ? await prepareCourseImport(input as FormData, provider, model)
      : kind === "schedule_image"
      ? await prepareScheduleImport(input as FormData, provider, model)
      : kind === "blackboard_image"
      ? await prepareBlackboardScreenshotImport(input as FormData, provider, model)
      : kind === "academic_calendar"
      ? await prepareAcademicCalendarImport(input as FormData, provider, model)
      : kind === "assessment_prediction"
      ? await prepareAssessmentPredictions(input, provider, model)
      : kind === "quick_capture"
      ? await prepareQuickCapture(input as string, provider, model)
      : kind === "daily_plan_advice"
      ? await prepareDailyPlanAdvice(input as string, provider, model)
      : kind === "material_summary" || kind === "material_study_questions"
      ? await prepareCourseMaterialIntelligence(input as string, kind, provider, model)
      : kind === "contextual_assistant"
      ? await prepareContextualAssistant(input as string, provider, model)
      : await prepareNoteIntelligence(input as string, kind, provider, model);
  return prepareAttempt(kind, prepared.requestId, provider, model, location);
}
export async function claimLocalInference(id: unknown) {
  const a = await loadInferenceAttempt(id);
  if (a.location === "cloud") throw new AiTrustError("capability_denied");
  const source = await readInferenceSource(a.kind, a.requestId, a.model);
  await rpc("claim_inference", { id: a.id, payload_digest: source.digest, consent: false });
  return source.inference;
}
async function finish(id: string, status: "failed" | "succeeded" | "cancelled", code?: string, batchId?: string, latencyMs?: number) {
  const safeCodes = ["provider_unavailable", "rate_limited", "missing_credentials", "local_unavailable", "timeout", "network_unavailable", "pairing_invalid", "invalid_output", "source_changed", "provider_rejected"];
  await rpc("finish_inference", { id, status, error_code: code ? (safeCodes.includes(code) ? code : "ai_unavailable") : null,
    batch_id: batchId ?? null, latency_ms: latencyMs === undefined ? null : Math.min(120000, Math.max(0, Math.round(latencyMs))) });
}
async function finalize(a: Awaited<ReturnType<typeof loadInferenceAttempt>>, raw: unknown, latencyMs?: number) {
  if (a.status !== "dispatching") throw new AiTrustError("request_unavailable");
  const review =
    a.kind === "checklist"
      ? await finalizeTaskChecklist(a.requestId, raw, true)
      : a.kind === "course"
      ? await finalizeCourseImport(a.requestId, raw, true)
      : a.kind === "schedule_image"
      ? await finalizeScheduleImport(a.requestId, raw)
      : a.kind === "blackboard_image"
      ? await finalizeBlackboardScreenshotImport(a.requestId, raw)
      : a.kind === "academic_calendar"
      ? await finalizeAcademicCalendarImport(a.requestId, raw)
      : a.kind === "assessment_prediction"
      ? await finalizeAssessmentPredictions(a.requestId, raw)
      : a.kind === "quick_capture"
      ? await finalizeQuickCapture(a.requestId, raw)
      : a.kind === "daily_plan_advice"
      ? await finalizeDailyPlanAdvice(a.requestId, raw)
      : a.kind === "material_summary" || a.kind === "material_study_questions"
      ? await finalizeCourseMaterialIntelligence(a.requestId, a.kind, raw)
      : a.kind === "contextual_assistant"
      ? await finalizeContextualAssistant(a.requestId, raw)
      : await finalizeNoteIntelligence(a.requestId, a.kind, raw);
  await finish(a.id, "succeeded", undefined, review.batchId, latencyMs);
  const provenance: InferenceProvenance = { provider: a.provider, model: a.model, location: a.location,
    evidence: a.location === "cloud" ? "server_response" : "browser_relay", latencyMs: latencyMs ?? null };
  return { ...review, provenance };
}
export async function finalizeLocalInference(id: unknown, raw: unknown) {
  const a = await loadInferenceAttempt(id);
  if (a.location === "cloud") throw new AiTrustError("capability_denied");
  try { return await finalize(a, raw); }
  catch (e) { await finish(a.id, "failed", "invalid_output"); throw e; }
}
/** Dedicated, authenticated Send once entrypoint. No browser payload/provider input. */
export async function sendCloudInference(id: unknown) {
  const a = await loadInferenceAttempt(id);
  if (!isCloud(a.provider) || a.location !== "cloud" || a.status !== "awaiting_consent") throw new AiTrustError("request_unavailable");
  const p = await routingPreferences();
  if (!cloudAllowed(a.capability, p)) throw new AiTrustError(p.cloudEnabled ? "cloud_privacy_denied" : "cloud_disabled");
  if (!routingChain(p, a.capability).includes(a.provider)) throw new AiTrustError("cloud_privacy_denied");
  let claimed = false;
  try {
    if (!cloudAvailability(a.provider).configured) throw new AiTrustError("missing_credentials");
    if (a.model !== cloudModel(a.provider)) throw new AiTrustError("provider_configuration_changed");
    const source = await readInferenceSource(a.kind, a.requestId, a.model);
    await rpc("claim_inference", { id: a.id, payload_digest: source.digest, consent: true });
    claimed = true;
    const start = performance.now();
    const raw = await inferCloud(a.provider, source.inference);
    const latencyMs = Math.round(performance.now() - start);
    return await finalize({ ...a, status: "dispatching" }, raw, latencyMs);
  } catch (e) {
    // A losing concurrent claim MUST NOT fail another request's in-flight attempt.
    const code = e instanceof AiTrustError ? e.code : "ai_unavailable";
    if (claimed || code === "missing_credentials") await finish(a.id, "failed", code);
    throw e;
  }
}
export async function failLocalInference(id: unknown, code: unknown) {
  const a = await loadInferenceAttempt(id);
  if (a.location === "cloud" || typeof code !== "string") throw new AiTrustError("capability_denied");
  await finish(a.id, "failed", code);
}
export async function cancelInference(id: unknown) {
  const a = await loadInferenceAttempt(id);
  // Once dispatched, cancellation cannot promise that egress was undone.
  if (!["ready", "awaiting_consent"].includes(a.status)) throw new AiTrustError("request_unavailable");
  await finish(a.id, "cancelled");
}
export async function prepareFallback(id: unknown) {
  const a = await loadInferenceAttempt(id), prefs = await routingPreferences();
  if (prefs.aiMode !== "auto" || a.status !== "failed" || !mayFallback(a.error_code ?? "", a.location)) throw new AiTrustError("fallback_denied");
  const chain = routingChain(prefs, a.capability);
  const at = chain.indexOf(isCloud(a.provider) ? a.provider : "local");
  const next = at >= 0 ? chain[at + 1] : undefined;
  if (!next || next === "local") throw new AiTrustError(prefs.cloudEnabled ? "cloud_privacy_denied" : "cloud_disabled");
  return prepareAttempt(a.kind, a.requestId, next, cloudAvailability(next).model ?? "unconfigured", "cloud", a.id);
}
