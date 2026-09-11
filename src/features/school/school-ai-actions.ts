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
  reviseScheduleImport,
} from "@/services/integrations/ai/schedule-import-repository";
import type { ScheduleEdit } from "@/services/integrations/ai/school-schedule-contract";
import {
  applyBlackboardScreenshotImport,
  reviseBlackboardScreenshotImport,
} from "@/services/integrations/ai/blackboard-screenshot-repository";
import type { BlackboardCourseEdit } from "@/services/integrations/ai/blackboard-screenshot-contract";
import {
  applyAcademicCalendarImport,
  prepareDeterministicAcademicCalendarImport,
  rejectAcademicCalendarImport,
  reviseAcademicCalendar,
} from "@/services/integrations/ai/academic-calendar-repository";
import type { AcademicCalendarEdit } from "@/services/integrations/ai/academic-calendar-contract";

export async function prepareScheduleImportAction(formData: FormData, local: unknown) {
  return prepareRoutedInference("schedule_image", formData, local);
}

export async function prepareBlackboardScreenshotAction(formData: FormData, local: unknown) {
  return prepareRoutedInference("blackboard_image", formData, local);
}

export async function prepareAcademicCalendarImportAction(formData: FormData, local: unknown) {
  return prepareRoutedInference("academic_calendar", formData, local);
}

export async function prepareDeterministicAcademicCalendarImportAction(formData: FormData) {
  return prepareDeterministicAcademicCalendarImport(formData);
}

export async function sendCloudInferenceAction(attemptId: string) {
  return sendCloudInference(attemptId);
}

export async function claimLocalInferenceAction(attemptId: string, transport?: { companionUrl: string; endpoint: string; pairingToken: string; deviceId: string }) {
  return claimLocalInference(attemptId, transport);
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

export async function reviseScheduleImportAction(batchId: string, courses: ScheduleEdit[]) {
  return reviseScheduleImport(batchId, courses);
}

export async function applyScheduleImportAction(batchId: string) {
  return applyScheduleImport(batchId);
}

export async function reviseBlackboardScreenshotAction(batchId: string, courses: BlackboardCourseEdit[]) {
  return reviseBlackboardScreenshotImport(batchId, courses);
}

export async function applyBlackboardScreenshotAction(batchId: string) {
  return applyBlackboardScreenshotImport(batchId);
}

export async function reviseAcademicCalendarAction(batchId: string, events: AcademicCalendarEdit[]) {
  return reviseAcademicCalendar(batchId, events);
}

export async function applyAcademicCalendarAction(batchId: string) {
  return applyAcademicCalendarImport(batchId);
}

export async function rejectAcademicCalendarAction(batchId: string) {
  return rejectAcademicCalendarImport(batchId);
}
