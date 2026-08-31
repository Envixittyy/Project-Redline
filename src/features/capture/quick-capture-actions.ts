"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";
import {
  applyQuickCaptureTask,
  applyQuickCaptureEvent,
} from "@/services/integrations/ai/quick-capture-repository";
import type {
  ProposedTaskCapture,
  ProposedEventCapture,
} from "@/services/integrations/ai/quick-capture-contract";

export async function prepareQuickCaptureAction(rawText: string, local: unknown) {
  return prepareRoutedInference("quick_capture", rawText, local);
}

export async function applyQuickCaptureTaskAction(draft: ProposedTaskCapture) {
  return applyQuickCaptureTask(draft);
}

export async function applyQuickCaptureEventAction(draft: ProposedEventCapture) {
  return applyQuickCaptureEvent(draft);
}

