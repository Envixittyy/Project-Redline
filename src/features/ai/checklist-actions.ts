"use server";
import { revalidatePath } from "next/cache";
import {
  finalizeTaskChecklist,
  prepareTaskChecklist,
  readChecklistReview,
} from "@/services/integrations/ai/checklist-repository";
import { AiTrustError } from "@/services/integrations/ai/trust-contract";

function failure(error: unknown) {
  return {
    ok: false as const,
    code: error instanceof AiTrustError ? error.code : "ai_unavailable",
    message:
      "AI request unavailable. If the task changed, prepare a new request. Normal task editing is unaffected.",
  };
}
export async function prepareTaskChecklistAction(
  taskId: unknown,
  provider: unknown,
  model: unknown,
) {
  try {
    return {
      ok: true as const,
      prepared: await prepareTaskChecklist(taskId, provider, model),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function finalizeTaskChecklistAction(
  requestId: unknown,
  untrustedOutput: unknown,
) {
  try {
    const review = await finalizeTaskChecklist(requestId, untrustedOutput);
    revalidatePath("/tasks");
    return { ok: true as const, review };
  } catch (error) {
    return failure(error);
  }
}
export async function reviewTaskChecklistAction(batchId: unknown) {
  try {
    return { ok: true as const, review: await readChecklistReview(batchId) };
  } catch (error) {
    return failure(error);
  }
}
