import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";
import { readProductReview, scopedFailure } from "./scoped-product-repository";
import { strictText } from "./strict-output";
import { validInferenceProvider } from "./routing-contract";
import {
  QUICK_CAPTURE_CAPABILITY,
  parseQuickCaptureOutput,
  type QuickCaptureReview,
} from "./quick-capture-contract";
import {
  recordNoteCaptureReview,
  reviseProductReview,
} from "./scoped-product-repository";
const capability = QUICK_CAPTURE_CAPABILITY.id;
export async function prepareQuickCapture(
  text: string,
  provider: unknown,
  model: unknown,
) {
  strictText(text, 2000, true);
  if (!validInferenceProvider(provider, model))
    throw new AiTrustError("invalid_provider");
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_prepare_capture",
    signAiCommand(userId, "prepare_capture", {
      text,
      provider,
      model,
      time_zone: resolveTimeZone(),
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return { requestId: result.data as string };
}
export async function readQuickCaptureReview(
  batchId: unknown,
): Promise<QuickCaptureReview> {
  const r = await readProductReview(batchId, capability);
  return {
    ...r,
    proposal: parseQuickCaptureOutput(
      JSON.stringify(r.input),
      capability,
      r.sourceHandle,
    ),
  };
}
export async function finalizeQuickCapture(requestId: string, raw: unknown) {
  return readQuickCaptureReview(
    await recordNoteCaptureReview(
      requestId,
      capability,
      raw,
      parseQuickCaptureOutput,
    ),
  );
}
export async function reviseQuickCapture(batchId: unknown, edited: unknown) {
  const r = await readQuickCaptureReview(batchId);
  const proposal = parseQuickCaptureOutput(
    JSON.stringify(edited),
    capability,
    r.sourceHandle,
  );
  return readQuickCaptureReview(
    await reviseProductReview(r.batchId, capability, proposal),
  );
}
export async function applyQuickCapture(batchId: unknown) {
  const r = await readQuickCaptureReview(batchId);
  const { client, userId } = await requireAuthenticatedSupabase();
  const result =
    r.proposal.captured.entityType === "task"
      ? await client.rpc(
          "ai_apply_capture_task",
          signAiCommand(userId, "approve_scoped:" + capability, {
            batch_id: uuid(batchId),
          }),
        )
      : await client.rpc(
          "ai_apply_capture_event",
          signAiCommand(userId, "approve_scoped:" + capability, {
            batch_id: uuid(batchId),
          }),
        );
  if (result.error || result.data?.ok !== true)
    scopedFailure(result.error?.message);
  return result.data as { ok: true; taskId?: string; eventId?: string };
}
export async function rejectQuickCapture(batchId: unknown) {
  await readQuickCaptureReview(batchId);
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", {
      batch_id: uuid(batchId),
    }),
  );
  if (error) scopedFailure(error.message);
}
