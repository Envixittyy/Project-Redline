import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";
import { readProductReview, scopedFailure } from "./scoped-product-repository";
import { validInferenceProvider } from "./routing-contract";
import {
  NOTE_SUMMARY_CAPABILITY,
  NOTE_REWRITE_CAPABILITY,
  NOTE_ACTION_ITEMS_CAPABILITY,
  parseNoteSummaryOutput,
  parseNoteRewriteOutput,
  parseNoteActionItemsOutput,
} from "./note-intelligence-contract";
import {
  recordNoteCaptureReview,
  reviseProductReview,
} from "./scoped-product-repository";
export type NoteKind = "note_summary" | "note_rewrite" | "note_action_items";
function contract(kind: NoteKind) {
  if (kind === "note_summary")
    return { cap: NOTE_SUMMARY_CAPABILITY.id, parse: parseNoteSummaryOutput };
  if (kind === "note_rewrite")
    return { cap: NOTE_REWRITE_CAPABILITY.id, parse: parseNoteRewriteOutput };
  if (kind === "note_action_items")
    return {
      cap: NOTE_ACTION_ITEMS_CAPABILITY.id,
      parse: parseNoteActionItemsOutput,
    };
  throw new AiTrustError("capability_denied");
}
export async function prepareNoteIntelligence(
  noteId: string,
  kind: NoteKind,
  provider: unknown,
  model: unknown,
) {
  const c = contract(kind);
  if (!validInferenceProvider(provider, model))
    throw new AiTrustError("invalid_provider");
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_prepare_note",
    signAiCommand(userId, "prepare_note", {
      note_id: uuid(noteId),
      capability: c.cap,
      provider,
      model,
      time_zone: resolveTimeZone(),
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return { requestId: result.data as string };
}
export async function readNoteReview(batchId: unknown, kind: NoteKind) {
  const c = contract(kind),
    r = await readProductReview(batchId, c.cap);
  const proposal = c.parse(JSON.stringify(r.input), c.cap, r.sourceHandle);
  return { ...r, ...proposal, proposal };
}
export async function finalizeNoteIntelligence(
  requestId: string,
  kind: NoteKind,
  raw: unknown,
) {
  const c = contract(kind);
  return readNoteReview(
    await recordNoteCaptureReview(requestId, c.cap, raw, c.parse),
    kind,
  );
}
export async function reviseNoteIntelligence(
  batchId: unknown,
  kind: NoteKind,
  edited: unknown,
) {
  const c = contract(kind),
    r = await readNoteReview(batchId, kind);
  const proposal = c.parse(JSON.stringify(edited), c.cap, r.sourceHandle);
  return readNoteReview(
    await reviseProductReview(r.batchId, c.cap, proposal),
    kind,
  );
}
export async function applyNoteSummary(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_apply_note_summary",
    signAiCommand(userId, "approve_scoped:" + contract("note_summary").cap, {
      batch_id: uuid(batchId),
    }),
  );
  if (result.error || result.data?.ok !== true)
    scopedFailure(result.error?.message);
  return result.data as { ok: true; noteId?: string; taskIds?: string[] };
}
export async function readNoteSummaryReview(batchId: unknown) {
  return readNoteReview(batchId, "note_summary");
}
export async function applyNoteRewrite(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_apply_note_rewrite",
    signAiCommand(userId, "approve_scoped:" + contract("note_rewrite").cap, {
      batch_id: uuid(batchId),
    }),
  );
  if (result.error || result.data?.ok !== true)
    scopedFailure(result.error?.message);
  return result.data as { ok: true; noteId?: string; taskIds?: string[] };
}
export async function readNoteRewriteReview(batchId: unknown) {
  return readNoteReview(batchId, "note_rewrite");
}
export async function applyNoteActionItems(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_apply_note_tasks",
    signAiCommand(
      userId,
      "approve_scoped:" + contract("note_action_items").cap,
      { batch_id: uuid(batchId) },
    ),
  );
  if (result.error || result.data?.ok !== true)
    scopedFailure(result.error?.message);
  return result.data as { ok: true; noteId?: string; taskIds?: string[] };
}
export async function readNoteActionItemsReview(batchId: unknown) {
  return readNoteReview(batchId, "note_action_items");
}
export async function rejectNoteIntelligence(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", {
      batch_id: uuid(batchId),
    }),
  );
  if (error) scopedFailure(error.message);
}
