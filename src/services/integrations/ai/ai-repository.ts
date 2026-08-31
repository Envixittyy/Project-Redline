import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import type { AiPreferences, AiProviderId } from "./types";

export class AiRepositoryError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "AiRepositoryError";
  }
}

type PreferencesRow = {
  ai_mode?: import("./routing-contract").AiMode;
  preferred_cloud?: import("./routing-contract").CloudProvider;
  secondary_cloud?: boolean;
  checklist_cloud?: boolean;
  course_import_cloud?: boolean;
  school_schedule_cloud?: boolean;
  blackboard_course_cloud?: boolean;
  academic_calendar_cloud?: boolean;
  assessment_prediction_cloud?: boolean;
  notes_cloud?: boolean;
  quick_capture_cloud?: boolean;
  daily_plan_cloud?: boolean;
  course_material_cloud?: boolean;
  contextual_assistant_cloud?: boolean;
  id: string;
  user_id: string;
  cloud_enabled: boolean;
  default_provider: AiProviderId | null;
  text_model: string | null;
  vision_model: string | null;
  embedding_model: string | null;
  cloud_fallback_mode: "off" | "ask_each_time" | "automatic_on_low_confidence";
  permission_mode: "suggest_only" | "ask_before_changing" | "trusted_automation";
  created_at: string;
  updated_at: string;
};

function toAiPreferences(row: PreferencesRow): AiPreferences {
  return {
    aiMode: row.ai_mode ?? "auto",
    preferredCloud: row.preferred_cloud ?? "gemini",
    secondaryCloud: row.secondary_cloud ?? false,
    checklistCloud: row.checklist_cloud ?? false,
    courseImportCloud: row.course_import_cloud ?? false,
    schoolScheduleCloud: row.school_schedule_cloud ?? false,
    blackboardCourseCloud: row.blackboard_course_cloud ?? false,
    academicCalendarCloud: row.academic_calendar_cloud ?? false,
    assessmentPredictionCloud: row.assessment_prediction_cloud ?? false,
    notesCloud: row.notes_cloud ?? false,
    quickCaptureCloud: row.quick_capture_cloud ?? false,
    dailyPlanCloud: row.daily_plan_cloud ?? false,
    courseMaterialCloud: row.course_material_cloud ?? false,
    contextualAssistantCloud: row.contextual_assistant_cloud ?? false,
    id: row.id,
    userId: row.user_id,
    cloudEnabled: row.cloud_enabled,
    defaultProvider: row.default_provider,
    textModel: row.text_model,
    visionModel: row.vision_model,
    embeddingModel: row.embedding_model,
    cloudFallbackMode: row.cloud_fallback_mode,
    permissionMode: row.permission_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Retrieves or initializes the user's AI preferences. */
export async function getAiPreferences(): Promise<AiPreferences> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client
    .from("ai_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[ai] fetch preferences error:", formatPostgrestErrorDiagnostic(error));
    throw new AiRepositoryError("Could not retrieve AI preferences.");
  }

  if (data) {
    return toAiPreferences(data as PreferencesRow);
  }

  // Create default preferences
  const { data: created, error: insertError } = await client
    .from("ai_preferences")
    .insert({
      user_id: userId,
      cloud_enabled: false,
      default_provider: "anthropic",
      cloud_fallback_mode: "ask_each_time",
      permission_mode: "ask_before_changing",
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[ai] insert preferences error:", formatPostgrestErrorDiagnostic(insertError));
    throw new AiRepositoryError("Could not initialize AI preferences.");
  }

  return toAiPreferences(created as PreferencesRow);
}

/** Updates user AI preferences. */
export async function updateAiPreferences(
  patch: Partial<Pick<AiPreferences, "cloudEnabled" | "defaultProvider" | "textModel" | "cloudFallbackMode" | "permissionMode" | "aiMode" | "preferredCloud" | "secondaryCloud" | "checklistCloud" | "courseImportCloud" | "schoolScheduleCloud" | "blackboardCourseCloud" | "academicCalendarCloud" | "assessmentPredictionCloud" | "notesCloud" | "quickCaptureCloud" | "dailyPlanCloud" | "courseMaterialCloud" | "contextualAssistantCloud">>,
): Promise<{ ok: boolean; message: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const allowedKeys = [
    "cloudEnabled","defaultProvider","textModel","cloudFallbackMode","permissionMode","aiMode","preferredCloud","secondaryCloud",
    "checklistCloud","courseImportCloud","schoolScheduleCloud","blackboardCourseCloud","academicCalendarCloud","assessmentPredictionCloud",
    "notesCloud","quickCaptureCloud","dailyPlanCloud","courseMaterialCloud","contextualAssistantCloud",
  ];

  if (!patch || typeof patch !== "object" || Array.isArray(patch)
    || Object.keys(patch).some(k => !allowedKeys.includes(k))
    || (patch.aiMode !== undefined && !["auto","local","gemini","openrouter"].includes(patch.aiMode))
    || (patch.preferredCloud !== undefined && !["gemini","openrouter"].includes(patch.preferredCloud))
    || [patch.secondaryCloud,patch.checklistCloud,patch.courseImportCloud,patch.schoolScheduleCloud,patch.blackboardCourseCloud,patch.academicCalendarCloud,patch.assessmentPredictionCloud,patch.notesCloud,patch.quickCaptureCloud,patch.dailyPlanCloud,patch.courseMaterialCloud,patch.contextualAssistantCloud].some(v => v !== undefined && typeof v !== "boolean")
    || (patch.cloudEnabled !== undefined && typeof patch.cloudEnabled !== "boolean")
    || (patch.defaultProvider != null && !["anthropic","gemini","openai"].includes(patch.defaultProvider))
    || (patch.textModel != null && (typeof patch.textModel !== "string" || patch.textModel.length > 200))
    || (patch.cloudFallbackMode !== undefined && !["off","ask_each_time","automatic_on_low_confidence"].includes(patch.cloudFallbackMode))
    || (patch.permissionMode !== undefined && !["suggest_only","ask_before_changing"].includes(patch.permissionMode))) {
    return { ok: false, message: "Invalid or unsupported AI preference." };
  }
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.cloudEnabled !== undefined) updatePayload.cloud_enabled = patch.cloudEnabled;
  if (patch.defaultProvider !== undefined) updatePayload.default_provider = patch.defaultProvider;
  if (patch.textModel !== undefined) updatePayload.text_model = patch.textModel;
  if (patch.cloudFallbackMode !== undefined) updatePayload.cloud_fallback_mode = patch.cloudFallbackMode;
  if (patch.permissionMode !== undefined) updatePayload.permission_mode = patch.permissionMode;
  if (patch.aiMode !== undefined) updatePayload.ai_mode = patch.aiMode;
  if (patch.preferredCloud !== undefined) updatePayload.preferred_cloud = patch.preferredCloud;
  if (patch.secondaryCloud !== undefined) updatePayload.secondary_cloud = patch.secondaryCloud;
  if (patch.checklistCloud !== undefined) updatePayload.checklist_cloud = patch.checklistCloud;
  if (patch.courseImportCloud !== undefined) updatePayload.course_import_cloud = patch.courseImportCloud;
  if (patch.schoolScheduleCloud !== undefined) updatePayload.school_schedule_cloud = patch.schoolScheduleCloud;
  if (patch.blackboardCourseCloud !== undefined) updatePayload.blackboard_course_cloud = patch.blackboardCourseCloud;
  if (patch.academicCalendarCloud !== undefined) updatePayload.academic_calendar_cloud = patch.academicCalendarCloud;
  if (patch.assessmentPredictionCloud !== undefined) updatePayload.assessment_prediction_cloud = patch.assessmentPredictionCloud;
  if (patch.notesCloud !== undefined) updatePayload.notes_cloud = patch.notesCloud;
  if (patch.quickCaptureCloud !== undefined) updatePayload.quick_capture_cloud = patch.quickCaptureCloud;
  if (patch.dailyPlanCloud !== undefined) updatePayload.daily_plan_cloud = patch.dailyPlanCloud;
  if (patch.courseMaterialCloud !== undefined) updatePayload.course_material_cloud = patch.courseMaterialCloud;
  if (patch.contextualAssistantCloud !== undefined) updatePayload.contextual_assistant_cloud = patch.contextualAssistantCloud;

  const { error } = await client
    .from("ai_preferences")
    .upsert(
      {
        user_id: userId,
        ...updatePayload,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[ai] update preferences error:", formatPostgrestErrorDiagnostic(error));
    return { ok: false, message: "Could not update AI preferences." };
  }

  return { ok: true, message: "AI preferences updated." };
}

/** Cancels a pending transfer request. */
export async function cancelAiTransfer(
  transferId: string,
): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireAuthenticatedSupabase();

  const rpcRes = await client.rpc("ai_cancel_transfer_request", {
    p_transfer_id: transferId,
  });

  if (rpcRes.error) {
    console.error("[ai] cancel transfer error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    return { ok: false, message: "Could not cancel transfer." };
  }

  return { ok: true, message: "Transfer cancelled." };
}

/** Clears completed or failed transfer audit records for the user. */
export async function clearAiTransferHistory(): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireAuthenticatedSupabase();

  const rpcRes = await client.rpc("ai_clear_transfer_history");
  if (rpcRes.error) {
    console.error("[ai] clear history error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    return { ok: false, message: "Could not clear transfer history." };
  }

  return { ok: true, message: "AI transfer history cleared." };
}
