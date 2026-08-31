"use server";

import {
  prepareRoutedInference,
  sendCloudInference,
  claimLocalInference,
  finalizeLocalInference,
  failLocalInference,
  cancelInference,
  prepareFallback,
} from "@/services/integrations/ai/inference-router";
import {
  applyScheduleImport,
  type ScheduleApplyInput,
} from "@/services/integrations/ai/schedule-import-repository";
import {
  applyBlackboardScreenshotImport,
  type BlackboardScreenshotApplyInput,
} from "@/services/integrations/ai/blackboard-screenshot-repository";
import {
  applyAcademicCalendarImport,
  type AcademicCalendarApplyInput,
} from "@/services/integrations/ai/academic-calendar-repository";

export async function prepareScheduleImportAction(formData: FormData, local: unknown) {
  return prepareRoutedInference("schedule_image", formData, local);
}

export async function prepareBlackboardScreenshotAction(formData: FormData, local: unknown) {
  return prepareRoutedInference("blackboard_image", formData, local);
}

export async function prepareAcademicCalendarImportAction(formData: FormData, local: unknown) {
  return prepareRoutedInference("academic_calendar", formData, local);
}

export async function sendCloudInferenceAction(attemptId: string) {
  return sendCloudInference(attemptId);
}

export async function claimLocalInferenceAction(attemptId: string) {
  return claimLocalInference(attemptId);
}

export async function finalizeLocalInferenceAction(attemptId: string, rawOutput: unknown) {
  return finalizeLocalInference(attemptId, rawOutput);
}

export async function failLocalInferenceAction(attemptId: string, code: string) {
  return failLocalInference(attemptId, code);
}

export async function cancelInferenceAction(attemptId: string) {
  return cancelInference(attemptId);
}

export async function prepareFallbackAction(attemptId: string) {
  return prepareFallback(attemptId);
}

export async function applyScheduleImportAction(input: ScheduleApplyInput) {
  return applyScheduleImport(input);
}

export async function applyBlackboardScreenshotAction(input: BlackboardScreenshotApplyInput) {
  return applyBlackboardScreenshotImport(input);
}

export async function applyAcademicCalendarAction(input: AcademicCalendarApplyInput) {
  return applyAcademicCalendarImport(input);
}

