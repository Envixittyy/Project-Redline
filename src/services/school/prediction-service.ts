import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { ConfidenceLevel, PredictionType } from "@/services/integrations/ai/assessment-prediction-contract";
import { signAiCommand } from "@/services/integrations/ai/trust-signing";

export type SchoolAssessmentPrediction = {
  id: string;
  userId: string;
  courseId: string;
  courseCode?: string;
  courseName?: string;
  courseColor?: string;
  predictionType: PredictionType;
  title: string;
  predictedDate: string;
  predictedTime: string | null;
  confidence: ConfidenceLevel;
  status: "active" | "dismissed" | "confirmed" | "superseded";
  rationale: string;
  sourceReference: string | null;
  createdAt: string;
  updatedAt: string;
};

type PredictionRow = {
  id: string;
  user_id: string;
  course_id: string;
  prediction_type: string;
  title: string;
  predicted_date: string;
  predicted_time: string | null;
  confidence: string;
  status: string;
  rationale: string;
  source_reference: string | null;
  created_at: string;
  updated_at: string;
  courses?: {
    code: string;
    name: string;
    color: string | null;
  } | null;
};

function toPrediction(row: PredictionRow): SchoolAssessmentPrediction {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    courseCode: row.courses?.code,
    courseName: row.courses?.name,
    courseColor: row.courses?.color || undefined,
    predictionType: row.prediction_type as PredictionType,
    title: row.title,
    predictedDate: row.predicted_date,
    predictedTime: row.predicted_time,
    confidence: row.confidence as ConfidenceLevel,
    status: row.status as SchoolAssessmentPrediction["status"],
    rationale: row.rationale,
    sourceReference: row.source_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listActivePredictions(): Promise<SchoolAssessmentPrediction[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("school_assessment_predictions")
    .select("*, courses(code, name, color)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("predicted_date", { ascending: true });

  if (error) {
    console.error("Failed to list active predictions:", error);
    return [];
  }

  return (data as PredictionRow[]).map(toPrediction);
}

export async function listPredictionsForCourse(courseId: string): Promise<SchoolAssessmentPrediction[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("school_assessment_predictions")
    .select("*, courses(code, name, color)")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .order("predicted_date", { ascending: true });

  if (error) {
    console.error(`Failed to list predictions for course ${courseId}:`, error);
    return [];
  }

  return (data as PredictionRow[]).map(toPrediction);
}

export async function dismissPrediction(predictionId: string): Promise<boolean> {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("dismiss_assessment_prediction", { p_prediction_id: predictionId });
  return !error && data?.ok === true;
}

/**
 * Atomically confirms a prediction into a Task.
 * 2 concurrent presses will result in at most 1 Task created and status set to confirmed.
 */
export async function confirmPredictionAsTask(
  predictionId: string,
  draft: {
    title: string;
    dueDate: string;
    dueAt?: string | null;
    priority?: "low" | "medium" | "high" | "urgent";
    courseId?: string;
  },
): Promise<{ ok: boolean; taskId?: string; message?: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client.rpc(
    "confirm_prediction_to_task",
    signAiCommand(userId, "confirm_prediction_task", {
      prediction_id: predictionId,
      title: draft.title,
      dueDate: draft.dueDate,
      priority: draft.priority,
    }),
  );

  if (error || !data || data.ok !== true) {
    return { ok: false, message: data?.error || error?.message || "Failed to confirm prediction as task." };
  }

  return { ok: true, taskId: data.taskId };
}

/**
 * Atomically confirms a prediction into a Calendar Event.
 */
export async function confirmPredictionAsEvent(
  predictionId: string,
  draft: {
    title: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    course?: string;
  },
): Promise<{ ok: boolean; eventId?: string; message?: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client.rpc(
    "confirm_prediction_to_event",
    signAiCommand(userId, "confirm_prediction_event", {
      prediction_id: predictionId,
      title: draft.title,
    }),
  );

  if (error || !data || data.ok !== true) {
    return { ok: false, message: data?.error || error?.message || "Failed to confirm prediction as event." };
  }

  return { ok: true, eventId: data.eventId };
}

export async function supersedeMatchingPredictions(
  courseId: string,
  title: string,
  confirmedDate: string,
): Promise<number> {
  const { client, userId } = await requireAuthenticatedSupabase();

  // Find active predictions for this course
  const { data: active } = await client
    .from("school_assessment_predictions")
    .select("id, title, predicted_date")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .eq("status", "active");

  if (!active || active.length === 0) return 0;

  const targetTitleLower = title.toLowerCase();
  const targetDateMs = new Date(confirmedDate).getTime();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

  const toSupersede: string[] = [];

  for (const pred of active) {
    const predDateMs = new Date(pred.predicted_date).getTime();
    const dateDiff = Math.abs(predDateMs - targetDateMs);
    const predTitleLower = pred.title.toLowerCase();

    // If date is within 2 days OR title words have high overlap
    const titleMatch =
      predTitleLower.includes(targetTitleLower) ||
      targetTitleLower.includes(predTitleLower) ||
      (targetTitleLower.includes("quiz") && predTitleLower.includes("quiz")) ||
      (targetTitleLower.includes("midterm") && predTitleLower.includes("midterm")) ||
      (targetTitleLower.includes("exam") && predTitleLower.includes("exam"));

    if (dateDiff <= twoDaysMs && titleMatch) {
      toSupersede.push(pred.id);
    }
  }

  if (toSupersede.length > 0) {
    await client
      .from("school_assessment_predictions")
      .update({ status: "superseded" })
      .in("id", toSupersede)
      .eq("user_id", userId);
  }

  return toSupersede.length;
}
