"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";
import {
  applyQuickCapture,
} from "@/services/integrations/ai/quick-capture-repository";

export async function prepareQuickCaptureAction(rawText: string, local: unknown) {
  return prepareRoutedInference("quick_capture", rawText, local);
}

export async function applyQuickCaptureAction(batchId: string) {
  return applyQuickCapture(batchId);
}
