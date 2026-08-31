import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
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
} from "./note-intelligence-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { createTask } from "@/services/tasks/task-repository";

export async function prepareNoteIntelligence(
  noteId: string,
  kind: "note_summary" | "note_rewrite" | "note_action_items",
  provider: string,
  model: string,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const validNoteId = uuid(noteId);

  const { data: note, error: noteErr } = await client
    .from("notes")
    .select("id,title,body")
    .eq("id", validNoteId)
    .eq("user_id", userId)
    .single();

  if (noteErr || !note) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `note_${randomUUID()}`;

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
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: capabilityId,
    source_handle: handle,
    file_name: `${note.title || "Untitled"}_${kind}.json`,
    source_text: sourceText,
    source_digest: sourceDigest,
    start_date: new Date().toISOString().slice(0, 10),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    provider,
    model,
    status: "prepared",
    expires_at: expiresAt,
  });

  if (error) throw new AiTrustError("request_unavailable");

  return {
    requestId,
    handle,
    promptData,
    payloadDigest: sourceDigest,
    bytes: Buffer.byteLength(sourceText),
    expiresAt,
  };
}

export async function finalizeNoteIntelligence(
  requestId: string,
  kind: "note_summary" | "note_rewrite" | "note_action_items",
  rawOutput: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: request, error: reqError } = await client
    .from("ai_course_requests")
    .select("id,source_handle,file_name,status,expires_at,capability")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();

  if (reqError || !request || request.status !== "prepared") {
    throw new AiTrustError("request_unavailable");
  }

  let proposal: unknown;
  if (kind === "note_summary") {
    proposal = parseNoteSummaryOutput(rawOutput, request.capability, request.source_handle);
  } else if (kind === "note_rewrite") {
    proposal = parseNoteRewriteOutput(rawOutput, request.capability, request.source_handle);
  } else {
    proposal = parseNoteActionItemsOutput(rawOutput, request.capability, request.source_handle);
  }

  const batchId = randomUUID();

  await client.from("operation_batches").insert({
    id: batchId,
    user_id: userId,
    source: "ai",
    status: "proposed",
    ai_course_request_id: request.id,
  });

  await client.from("operation_steps").insert({
    id: randomUUID(),
    batch_id: batchId,
    user_id: userId,
    position: 0,
    action_type: request.capability,
    input: proposal as Record<string, unknown>,
  });

  return {
    batchId,
    proposal,
    status: "proposed",
    sourceHandle: request.source_handle,
  };
}

export async function applyNoteRewriteAction(
  noteId: string,
  rewrittenBody: string,
  mode: "replace" | "append",
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const validNoteId = uuid(noteId);

  const { data: note, error: fetchErr } = await client
    .from("notes")
    .select("id,body")
    .eq("id", validNoteId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !note) return { ok: false, message: "Note not found." };

  const newBody = mode === "replace" ? rewrittenBody : `${note.body}\n\n---\n\n${rewrittenBody}`;

  const { error: updateErr } = await client
    .from("notes")
    .update({ body: newBody, updated_at: new Date().toISOString() })
    .eq("id", validNoteId)
    .eq("user_id", userId);

  if (updateErr) return { ok: false, message: "Failed to update note body." };

  return { ok: true, newBody };
}

export async function applyNoteActionItemsAction(
  noteId: string,
  items: Array<{ title: string; dueDate?: string; priority?: "low" | "medium" | "high" | "urgent" }>,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const validNoteId = uuid(noteId);

  const { data: note } = await client
    .from("notes")
    .select("id,course_id")
    .eq("id", validNoteId)
    .eq("user_id", userId)
    .single();

  let createdCount = 0;
  for (const item of items) {
    try {
      await createTask({
        title: item.title,
        dueDate: item.dueDate || null,
        priority: item.priority || "medium",
        courseId: note?.course_id || null,
      });
      createdCount++;
    } catch (e) {
      console.error("Failed to create action item task:", e);
    }
  }

  return { ok: true, count: createdCount };
}
