"use server";
import { revalidatePath } from "next/cache";
import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";
import {
  applyQuickCapture,
  reviseQuickCapture,
} from "@/services/integrations/ai/quick-capture-repository";
export async function prepareQuickCaptureAction(
  rawText: string,
  local: unknown,
) {
  return prepareRoutedInference("quick_capture", rawText, local);
}
export async function reviseQuickCaptureAction(id: string, proposal: unknown) {
  return reviseQuickCapture(id, proposal);
}
export async function applyQuickCaptureAction(id: string) {
  const r = await applyQuickCapture(id);
  for (const p of ["/tasks", "/calendar", "/inbox", "/"]) revalidatePath(p);
  return r;
}
