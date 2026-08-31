import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  CONTEXTUAL_ASSISTANT_CAPABILITY,
  contextualAssistantPrompt,
  parseContextualAssistantOutput,
} from "./contextual-assistant-contract";
import { AiTrustError, uuid } from "./trust-contract";

export async function prepareContextualAssistant(
  inputPayload: string,
  provider: string,
  model: string,
) {
  const { client, userId } = await requireAuthenticatedSupabase();

  let payload: {
    entityType: "task" | "course" | "note" | "course_material";
    entityId: string;
    question: string;
  };

  try {
    payload = JSON.parse(inputPayload);
  } catch {
    throw new AiTrustError("request_unavailable");
  }

  const validEntityId = uuid(payload.entityId);
  const question = String(payload.question || "").trim();
  if (!question) throw new AiTrustError("request_unavailable");

  let title = "Context";
  let body = "";

  if (payload.entityType === "note") {
    const { data: note } = await client
      .from("notes")
      .select("title,body")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (note) {
      title = note.title;
      body = note.body;
    }
  } else if (payload.entityType === "task") {
    const { data: task } = await client
      .from("tasks")
      .select("title,description")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (task) {
      title = task.title;
      body = task.description || "No description.";
    }
  } else if (payload.entityType === "course") {
    const { data: course } = await client
      .from("courses")
      .select("code,name,description")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (course) {
      title = `${course.code} - ${course.name}`;
      body = course.description || "No description.";
    }
  } else if (payload.entityType === "course_material") {
    const { data: mat } = await client
      .from("course_materials")
      .select("title,content,description")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (mat) {
      title = mat.title;
      body = mat.content || mat.description || "No content.";
    }
  }

  if (!body) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `ctx_${randomUUID()}`;
  const promptData = contextualAssistantPrompt(handle, {
    entityType: payload.entityType,
    title,
    body,
    userQuestion: question,
  });

  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: CONTEXTUAL_ASSISTANT_CAPABILITY.id,
    source_handle: handle,
    file_name: `contextual_${payload.entityType}.json`,
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

export async function finalizeContextualAssistant(
  requestId: string,
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

  const proposal = parseContextualAssistantOutput(rawOutput, request.capability, request.source_handle);
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
