"use server";

import {
  prepareRoutedInference,
} from "@/services/integrations/ai/inference-router";
import {
  applyAssessmentPredictions,
  type AssessmentPredictionApplyInput,
} from "@/services/integrations/ai/assessment-prediction-repository";
import {
  listActivePredictions,
  listPredictionsForCourse,
  dismissPrediction,
  confirmPredictionAsTask,
  confirmPredictionAsEvent,
} from "@/services/school/prediction-service";

export async function prepareAssessmentPredictionsAction(courseId: string, local: unknown) {
  return prepareRoutedInference("assessment_prediction", courseId, local);
}

export async function applyAssessmentPredictionsAction(input: AssessmentPredictionApplyInput) {
  return applyAssessmentPredictions(input);
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

export async function confirmPredictionAsTaskAction(
  predictionId: string,
  draft: {
    title: string;
    dueDate: string;
    dueAt?: string | null;
    priority?: "low" | "medium" | "high" | "urgent";
    courseId?: string;
  },
) {
  try {
    return await confirmPredictionAsTask(predictionId, draft);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function confirmPredictionAsEventAction(
  predictionId: string,
  draft: {
    title: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    course?: string;
  },
) {
  try {
    return await confirmPredictionAsEvent(predictionId, draft);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

