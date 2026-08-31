import { AiTrustError, CHECKLIST_CAPABILITY } from "./trust-contract";
import { COURSE_IMPORT_CAPABILITY } from "./course-import-contract";
import { SCHEDULE_IMAGE_CAPABILITY } from "./school-schedule-contract";
import { BLACKBOARD_COURSE_IMAGE_CAPABILITY } from "./blackboard-screenshot-contract";
import { ACADEMIC_CALENDAR_CAPABILITY } from "./academic-calendar-contract";
import { ASSESSMENT_PREDICTION_CAPABILITY } from "./assessment-prediction-contract";
import { isModelId } from "@/companion/network-policy";
import type { LocalInferenceRequest } from "@/companion/types";
import type { LocalProviderType } from "./types";

export type AiMode = "auto" | "local" | "gemini" | "openrouter";
export type CloudProvider = "gemini" | "openrouter";
export type InferenceProvider = LocalProviderType | CloudProvider;
export type InferenceLocation = "local" | "remote_local" | "cloud";
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

export type RequestKind =
  | "checklist"
  | "course"
  | "schedule_image"
  | "blackboard_image"
  | "academic_calendar"
  | "assessment_prediction"
  | "note_summary"
  | "note_rewrite"
  | "note_action_items"
  | "quick_capture"
  | "daily_plan_advice"
  | "material_summary"
  | "material_study_questions"
  | "contextual_assistant";
export type RoutingPreferences = {
  aiMode: AiMode;
  cloudEnabled: boolean;
  cloudFallbackMode: string;
  preferredCloud: CloudProvider;
  secondaryCloud: boolean;
  checklistCloud: boolean;
  courseImportCloud: boolean;
};
export type InferenceProvenance = {
  provider: InferenceProvider;
  model: string;
  location: InferenceLocation;
  evidence: "browser_relay" | "server_response";
  latencyMs: number | null;
};
export type LocalSelection = { provider: LocalProviderType; model: string; location: "local" | "remote_local" };
export type RoutedPreparation = {
  attemptId: string;
  requestId: string;
  kind: RequestKind;
  provider: InferenceProvider;
  model: string;
  location: InferenceLocation;
  inference?: LocalInferenceRequest;
  disclosure: {
    purpose: string;
    fields: readonly string[];
    sources: number;
    bytes: number;
    expiresAt: string;
    privacyUrl?: string;
  };
};

export function capabilityFor(kind: RequestKind) {
  if (kind === "checklist") return CHECKLIST_CAPABILITY;
  if (kind === "course") return COURSE_IMPORT_CAPABILITY;
  if (kind === "schedule_image") return SCHEDULE_IMAGE_CAPABILITY;
  if (kind === "blackboard_image") return BLACKBOARD_COURSE_IMAGE_CAPABILITY;
  if (kind === "academic_calendar") return ACADEMIC_CALENDAR_CAPABILITY;
  if (kind === "assessment_prediction") return ASSESSMENT_PREDICTION_CAPABILITY;
  if (kind === "note_summary") return NOTE_SUMMARY_CAPABILITY;
  if (kind === "note_rewrite") return NOTE_REWRITE_CAPABILITY;
  if (kind === "note_action_items") return NOTE_ACTION_ITEMS_CAPABILITY;
  if (kind === "quick_capture") return QUICK_CAPTURE_CAPABILITY;
  if (kind === "daily_plan_advice") return DAILY_PLAN_ADVICE_CAPABILITY;
  if (kind === "material_summary") return COURSE_MATERIAL_SUMMARY_CAPABILITY;
  if (kind === "material_study_questions") return COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY;
  if (kind === "contextual_assistant") return CONTEXTUAL_ASSISTANT_CAPABILITY;
  throw new AiTrustError("capability_denied");
}
/** Unknown/future domains (including journals/wellness) fail closed. */
export function cloudAllowed(capability: string, prefs: RoutingPreferences): boolean {
  if (!prefs.cloudEnabled || prefs.cloudFallbackMode === "off") return false;
  if (
    capability === CHECKLIST_CAPABILITY.id ||
    capability === QUICK_CAPTURE_CAPABILITY.id ||
    capability === DAILY_PLAN_ADVICE_CAPABILITY.id ||
    capability === CONTEXTUAL_ASSISTANT_CAPABILITY.id
  ) {
    return prefs.checklistCloud === true;
  }
  if (
    capability === COURSE_IMPORT_CAPABILITY.id ||
    capability === SCHEDULE_IMAGE_CAPABILITY.id ||
    capability === BLACKBOARD_COURSE_IMAGE_CAPABILITY.id ||
    capability === ACADEMIC_CALENDAR_CAPABILITY.id ||
    capability === ASSESSMENT_PREDICTION_CAPABILITY.id ||
    capability === NOTE_SUMMARY_CAPABILITY.id ||
    capability === NOTE_REWRITE_CAPABILITY.id ||
    capability === NOTE_ACTION_ITEMS_CAPABILITY.id ||
    capability === COURSE_MATERIAL_SUMMARY_CAPABILITY.id ||
    capability === COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id
  ) {
    return prefs.courseImportCloud === true;
  }
  return false;
}
export function isCloud(provider: string): provider is CloudProvider {
  return provider === "gemini" || provider === "openrouter";
}
export function validInferenceProvider(provider: unknown, model: unknown): provider is InferenceProvider {
  return typeof provider === "string" && ["ollama", "llamacpp", "openai_compatible", "gemini", "openrouter"].includes(provider) && isModelId(model);
}
export function localSelection(value: unknown): LocalSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiTrustError("invalid_provider");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["provider", "model", "location"].includes(k)) ||
      !["ollama", "llamacpp", "openai_compatible"].includes(String(v.provider)) || !isModelId(v.model) ||
      !["local", "remote_local"].includes(String(v.location))) throw new AiTrustError("invalid_provider");
  return v as LocalSelection;
}
/** Routing is server preference state, never model/source text. No mutation API here. */
export function routingChain(prefs: RoutingPreferences, capability: string): ("local" | CloudProvider)[] {
  if (!["auto", "local", "gemini", "openrouter"].includes(prefs.aiMode)) throw new AiTrustError("invalid_provider");
  if (prefs.aiMode === "local") return ["local"];
  if (isCloud(prefs.aiMode)) {
    if (!cloudAllowed(capability, prefs)) throw new AiTrustError(prefs.cloudEnabled ? "cloud_privacy_denied" : "cloud_disabled");
    return [prefs.aiMode];
  }
  if (!cloudAllowed(capability, prefs)) return ["local"];
  const primary = prefs.preferredCloud === "openrouter" ? "openrouter" : "gemini";
  return prefs.secondaryCloud ? ["local", primary, primary === "gemini" ? "openrouter" : "gemini"] : ["local", primary];
}
// Timeout/network loss is ambiguous for cloud egress: requires a new user request,
// not an automatic second upload. Malformed/model/permission failures never fallback.
export function mayFallback(code: string, location: InferenceLocation) {
  return ["provider_unavailable", "rate_limited", "missing_credentials", "local_unavailable"].includes(code) ||
    (location !== "cloud" && ["timeout", "network_unavailable"].includes(code));
}
export function routingMessage(code: string): string {
  const messages: Record<string, string> = {
    local_unavailable: "Local AI is unavailable. Check the home PC, private network, Companion and model. No changes were made.",
    pairing_invalid: "Pairing expired or was revoked. Re-pair in AI Settings. Nothing was applied.",
    cloud_disabled: "Cloud AI is disabled. Local inference could not continue.",
    cloud_privacy_denied: "Cloud transfer is not allowed for this capability. Nothing was sent to cloud.",
    timeout: "AI timed out. Cloud delivery may be uncertain; review a new request before sending again.",
    rate_limited: "The provider is rate limited. No changes were made.",
    provider_unavailable: "The inference provider is unavailable. Normal Forward features still work.",
    missing_credentials: "This cloud provider is not configured on the server.",
    cancelled: "AI request cancelled. No application changes were made.",
    invalid_output: "The model returned an invalid proposal. Nothing was applied and no fallback was sent.",
    source_changed: "The source changed. Review the current data and start a new request.",
  };
  return messages[code] ?? "AI request unavailable. Check setup, pairing and expiry. Normal editing is unaffected.";
}
