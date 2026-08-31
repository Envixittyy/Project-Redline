import "server-only";
import { schoolIntelligenceUnavailable } from "./school-intelligence-policy";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  NOTE_SUMMARY_CAPABILITY,
  NOTE_REWRITE_CAPABILITY,
  NOTE_ACTION_ITEMS_CAPABILITY,
  noteSummaryPrompt,
  noteRewritePrompt,
  noteActionItemsPrompt,
  parseNoteSummaryOutput,
  parseNoteRewriteOutput,
  parseNoteActionItemsOutput,
  type NoteSummaryReview,
  type NoteRewriteReview,
  type NoteActionItemsReview,
} from "./note-intelligence-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareNoteIntelligence(
  noteId: string,
  kind: "note_summary" | "note_rewrite" | "note_action_items",
  provider: unknown,
  model: unknown,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }
  const validNoteId = uuid(noteId);

  const { data: note, error: noteErr } = await client
    .from("notes")
    .select("id,title,body")
    .eq("id", validNoteId)
    .eq("user_id", userId)
    .single();

  if (noteErr || !note) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `note_${randomUUID().replaceAll("-", "")}`;

  let promptData;
  let capabilityId: string;

  if (kind === "note_summary") {
    promptData = noteSummaryPrompt(handle, note);
    capabilityId = NOTE_SUMMARY_CAPABILITY.id;
  } else if (kind === "note_rewrite") {
    promptData = noteRewritePrompt(handle, note);
    capabilityId = NOTE_REWRITE_CAPABILITY.id;
  } else {
    promptData = noteActionItemsPrompt(handle, note);
    capabilityId = NOTE_ACTION_ITEMS_CAPABILITY.id;
  }

  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const timeZone = resolveTimeZone();
  const startDate = todayIn(timeZone);

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: capabilityId,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: `${note.title || "Untitled"}_${kind}.json`,
      start_date: startDate,
      time_zone: timeZone,
      provider,
      model,
    }),
  );

  if (error) throw new AiTrustError("request_not_prepared");

  return {
    requestId,
    handle,
    promptData,
    payloadDigest: sourceDigest,
    bytes: Buffer.byteLength(sourceText),
  };
}

async function loadScopedReview(batchId: unknown) {
  schoolIntelligenceUnavailable();
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return data;
}

export async function readNoteSummaryReview(batchId: unknown): Promise<NoteSummaryReview> {
  const r = await loadScopedReview(batchId);
  const proposal = parseNoteSummaryOutput(JSON.stringify(r.input), r.capability, r.sourceHandle);
  return {
    batchId: r.batchId,
    summary: proposal.summary,
    keyPoints: proposal.keyPoints,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function readNoteRewriteReview(batchId: unknown): Promise<NoteRewriteReview> {
  const r = await loadScopedReview(batchId);
  const proposal = parseNoteRewriteOutput(JSON.stringify(r.input), r.capability, r.sourceHandle);
  return {
    batchId: r.batchId,
    rewrittenTitle: proposal.rewrittenTitle,
    rewrittenBody: proposal.rewrittenBody,
    changesExplanation: proposal.changesExplanation,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function readNoteActionItemsReview(batchId: unknown): Promise<NoteActionItemsReview> {
  const r = await loadScopedReview(batchId);
  const proposal = parseNoteActionItemsOutput(JSON.stringify(r.input), r.capability, r.sourceHandle);
  return {
    batchId: r.batchId,
    actionItems: proposal.actionItems,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function finalizeNoteIntelligence(
  requestId: string,
  kind: "note_summary" | "note_rewrite" | "note_action_items",
  rawOutput: unknown,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: request, error: reqError } = await client
    .from("ai_scoped_requests")
    .select("id,source_handle,file_name,status,source_text,source_digest,capability,expires_at")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();

  if (
    reqError ||
    !request ||
    request.status !== "prepared" ||
    Date.parse(request.expires_at) <= Date.now()
  ) {
    throw new AiTrustError("request_unavailable");
  }

  if (createHash("sha256").update(request.source_text).digest("hex") !== request.source_digest) {
    throw new AiTrustError("source_changed");
  }

  let proposal: unknown;
  if (kind === "note_summary") {
    proposal = parseNoteSummaryOutput(rawOutput, request.capability, request.source_handle);
  } else if (kind === "note_rewrite") {
    proposal = parseNoteRewriteOutput(rawOutput, request.capability, request.source_handle);
  } else {
    proposal = parseNoteActionItemsOutput(rawOutput, request.capability, request.source_handle);
  }

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: `Note Intelligence: ${kind}`,
      target_entity: "note",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  if (kind === "note_summary") return readNoteSummaryReview(result.data);
  if (kind === "note_rewrite") return readNoteRewriteReview(result.data);
  return readNoteActionItemsReview(result.data);
}

export async function applyNoteRewrite(
  batchId: unknown,
  noteId: string,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const r = await loadScopedReview(batchId);

  const { data, error } = await client.rpc(
    "apply_ai_note_rewrite",
    signAiCommand(userId, "approve_note_rewrite", {
      batch_id: r.batchId,
      note_id: uuid(noteId),
      proposal_digest: r.proposalDigest,
    }),
  );

  if (error || !data) {
    throw new AiTrustError("request_unavailable");
  }

  return { ok: true, ...data };
}

export async function applyNoteActionItems(
  batchId: unknown,
  noteId: string,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const r = await loadScopedReview(batchId);

  const { data, error } = await client.rpc(
    "apply_ai_note_action_items",
    signAiCommand(userId, "approve_note_action_items", {
      batch_id: r.batchId,
      note_id: uuid(noteId),
      proposal_digest: r.proposalDigest,
    }),
  );

  if (error || !data) {
    throw new AiTrustError("request_unavailable");
  }

  return { ok: true, ...data };
}

export async function rejectNoteIntelligence(batchId: unknown) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", { batch_id: uuid(batchId) }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
