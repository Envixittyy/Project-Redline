import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  CONTEXTUAL_ASSISTANT_CAPABILITY,
  contextualAssistantPrompt,
  parseContextualAssistantOutput,
  type ContextualAssistantReview,
} from "./contextual-assistant-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareContextualAssistant(
  inputPayload: string,
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }

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
  if (!question || !["task", "course", "note", "course_material"].includes(payload.entityType)) {
    throw new AiTrustError("request_unavailable");
  }

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
      .select("title,due_date,priority,status")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (task) {
      title = task.title;
      body = `Task: ${task.title}, Due: ${task.due_date || "none"}, Priority: ${task.priority}, Status: ${task.status}`;
    }
  } else if (payload.entityType === "course") {
    const { data: course } = await client
      .from("courses")
      .select("code,name,instructor,location")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (course) {
      title = `${course.code} - ${course.name}`;
      body = `Course: ${course.code} ${course.name}, Instructor: ${course.instructor || "none"}, Location: ${course.location || "none"}`;
    }
  } else if (payload.entityType === "course_material") {
    const { data: mat } = await client
      .from("course_materials")
      .select("title,type,description")
      .eq("id", validEntityId)
      .eq("user_id", userId)
      .single();
    if (mat) {
      title = mat.title;
      body = mat.description || `Course Material (${mat.type}): ${mat.title}`;
    }
  }

  if (!body) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `ctx_${randomUUID().replaceAll("-", "")}`;
  const promptData = contextualAssistantPrompt(handle, {
    entityType: payload.entityType,
    title,
    body,
    userQuestion: question,
  });

  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const timeZone = resolveTimeZone();
  const startDate = todayIn(timeZone);

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: CONTEXTUAL_ASSISTANT_CAPABILITY.id,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: `contextual_${payload.entityType}.json`,
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

async function loadReview(batchId: unknown) {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const proposal = parseContextualAssistantOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return { ...data, answer: proposal } as ContextualAssistantReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}

export async function readContextualAssistantReview(
  batchId: unknown,
): Promise<ContextualAssistantReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    answer: r.answer,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function finalizeContextualAssistant(
  requestId: string,
  rawOutput: unknown,
): Promise<ContextualAssistantReview> {
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

  const proposal = parseContextualAssistantOutput(rawOutput, request.capability, request.source_handle);

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: "Contextual Assistant Answer",
      target_entity: "contextual_assistant",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  return readContextualAssistantReview(result.data);
}
