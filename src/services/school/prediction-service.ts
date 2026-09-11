import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { ConfidenceLevel, PredictionType } from "@/services/integrations/ai/assessment-prediction-contract";

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
  stale?: boolean;
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
  generation_request_id: string;
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

async function withFreshness(rows: PredictionRow[]): Promise<SchoolAssessmentPrediction[]> {
  const { client } = await requireAuthenticatedSupabase();
  const freshness = new Map<string, boolean>();
  await Promise.all([...new Set(rows.map(row => row.generation_request_id))].map(async requestId => {
    const { data, error } = await client.rpc("ai_school_prediction_fresh", { p_request_id: requestId });
    freshness.set(requestId, !error && data === true);
  }));
  return rows.map(row => ({ ...toPrediction(row), stale: freshness.get(row.generation_request_id) !== true }));
}

export async function listActivePredictions(): Promise<SchoolAssessmentPrediction[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("school_assessment_predictions")
    .select("*, courses(code, name, color)")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("generation_request_id", "is", null)
    .order("predicted_date", { ascending: true }).limit(100);

  if (error) {
    console.error("Failed to list active predictions:", error);
    return [];
  }

  return (await withFreshness(data as PredictionRow[])).filter(p => !p.stale && p.confidence !== "LOW");
}

export async function listPredictionsForCourse(courseId: string): Promise<SchoolAssessmentPrediction[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("school_assessment_predictions")
    .select("*, courses(code, name, color)")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .not("generation_request_id", "is", null)
    .order("predicted_date", { ascending: true }).limit(100);

  if (error) {
    console.error(`Failed to list predictions for course ${courseId}:`, error);
    return [];
  }

  return withFreshness(data as PredictionRow[]);
}

export async function dismissPrediction(predictionId: string): Promise<boolean> {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("dismiss_assessment_prediction", { p_prediction_id: predictionId });
  return !error && data?.ok === true;
}
