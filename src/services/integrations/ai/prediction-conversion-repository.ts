import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";
import { readProductReview, scopedFailure } from "./scoped-product-repository";
import {
  parseCaptureItem,
  type ProposedTaskCapture,
  type ProposedEventCapture,
} from "./quick-capture-contract";
import { strictObject } from "./strict-output";
import { reviseProductReview } from "./scoped-product-repository";
export type ConversionKind = "task" | "calendar_event";
export type ConversionReview = {
  batchId: string;
  sourceHandle: string;
  timeZone: string;
  proposal: {
    schema_version: 1;
    type: "propose_prediction_conversion";
    source_handle: string;
    captured: ProposedTaskCapture | ProposedEventCapture;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  };
};
function cap(kind: ConversionKind) {
  if (kind === "task") return "predictionTask.propose";
  if (kind === "calendar_event") return "predictionEvent.propose";
  throw new AiTrustError("capability_denied");
}
async function readReview(
  batchId: unknown,
  kind: ConversionKind,
): Promise<ConversionReview> {
  const r = await readProductReview(batchId, cap(kind));
  const p = strictObject(r.input, [
    "schema_version",
    "type",
    "source_handle",
    "captured",
    "confidence",
  ]);
  if (
    p.schema_version !== 1 ||
    p.type !== "propose_prediction_conversion" ||
    p.source_handle !== r.sourceHandle ||
    !["HIGH", "MEDIUM", "LOW"].includes(p.confidence as string) ||
    parseCaptureItem(p.captured).entityType !== kind
  )
    throw new AiTrustError("untrusted_proposal");
  return { ...r, proposal: p as ConversionReview["proposal"] };
}
export async function preparePredictionConversion(
  predictionId: unknown,
  kind: ConversionKind,
) {
  cap(kind);
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_prepare_prediction_conversion",
    signAiCommand(userId, "prepare_prediction_conversion", {
      prediction_id: uuid(predictionId),
      kind,
      time_zone: resolveTimeZone(),
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return readReview(result.data, kind);
}
export async function revisePredictionConversion(
  batchId: unknown,
  kind: ConversionKind,
  edited: unknown,
) {
  const r = await readReview(batchId, kind);
  const captured = parseCaptureItem(edited);
  if (captured.entityType !== kind) throw new AiTrustError("capability_denied");
  return readReview(
    await reviseProductReview(r.batchId, cap(kind), {
      ...r.proposal,
      captured,
    }),
    kind,
  );
}
export async function applyPredictionTask(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_apply_prediction_task",
    signAiCommand(userId, "approve_scoped:predictionTask.propose", {
      batch_id: uuid(batchId),
    }),
  );
  if (result.error || result.data?.ok !== true)
    scopedFailure(result.error?.message);
  return { ok: true as const };
}
export async function applyPredictionEvent(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_apply_prediction_event",
    signAiCommand(userId, "approve_scoped:predictionEvent.propose", {
      batch_id: uuid(batchId),
    }),
  );
  if (result.error || result.data?.ok !== true)
    scopedFailure(result.error?.message);
  return { ok: true as const };
}
