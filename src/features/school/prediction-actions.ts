"use server";

import {
  prepareRoutedInference,
} from "@/services/integrations/ai/inference-router";
import {
  applyAssessmentPredictions,
  reviseAssessmentPredictions,
  rejectAssessmentPredictions,
} from "@/services/integrations/ai/assessment-prediction-repository";
import type { ProposedPrediction } from "@/services/integrations/ai/assessment-prediction-contract";
import { revalidatePath } from "next/cache";
import {
  listActivePredictions,
  listPredictionsForCourse,
  dismissPrediction,
} from "@/services/school/prediction-service";

export async function prepareAssessmentPredictionsAction(
  selection: { courseId: string; syllabusMaterialId: string },
  local: unknown,
) {
  return prepareRoutedInference("assessment_prediction", selection, local);
}

export async function reviseAssessmentPredictionsAction(batchId: string, predictions: ProposedPrediction[]) {
  return reviseAssessmentPredictions(batchId, predictions);
}

export async function applyAssessmentPredictionsAction(batchId: string) {
  const result = await applyAssessmentPredictions(batchId);
  revalidatePath("/school");
  revalidatePath("/");
  revalidatePath("/calendar");
  return result;
}

export async function rejectAssessmentPredictionsAction(batchId: string) {
  await rejectAssessmentPredictions(batchId);
}

export async function getActivePredictionsAction() {
  try {
    const predictions = await listActivePredictions();
    return { ok: true, predictions };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function getCoursePredictionsAction(courseId: string) {
  try {
    const predictions = await listPredictionsForCourse(courseId);
    return { ok: true, predictions };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function dismissPredictionAction(predictionId: string) {
  try {
    const success = await dismissPrediction(predictionId);
    return { ok: success };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
