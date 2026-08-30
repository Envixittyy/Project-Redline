import "server-only";
import { randomUUID } from "node:crypto";
import { isModelId } from "@/companion/network-policy";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  applyReviewedTaskChecklist,
  readTaskChecklistContext,
} from "@/services/tasks/task-repository";
import {
  AiTrustError,
  CHECKLIST_CAPABILITY,
  checklistPrompt,
  parseChecklistOutput,
  uuid,
  type ChecklistReview,
} from "./trust-contract";
import { signAiCommand } from "./trust-signing";
import type { LocalProviderType } from "./types";

export async function prepareTaskChecklist(
  taskId: unknown,
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const id = uuid(taskId);
  if (
    typeof provider !== "string" ||
    !["ollama", "llamacpp", "openai_compatible"].includes(provider) ||
    !isModelId(model)
  )
    throw new AiTrustError("invalid_provider");
  const context = await readTaskChecklistContext(id);
  const requestId = randomUUID();
  const handle = `task_${randomUUID().replaceAll("-", "")}`;
  const inference = checklistPrompt(context, handle);
  const proof = signAiCommand(userId, "prepare_checklist", {
    id: requestId,
    task_id: id,
    task_handle: handle,
    source_revision: context.revision,
    capability: CHECKLIST_CAPABILITY.id,
    provider,
    model,
  });
  const { error } = await client.rpc("ai_create_checklist_request", proof);
  if (error) throw new AiTrustError("request_not_prepared");
  return {
    requestId,
    provider: provider as LocalProviderType,
    inference: { ...inference, model },
    disclosure: {
      taskTitle: context.title,
      fields: [...CHECKLIST_CAPABILITY.inputFields],
      sources: 1,
      provider,
      model,
    },
  };
}

type PersistedReview = ChecklistReview & {
  proposal: unknown;
  proposalDigest: string;
  capability: string;
  taskHandle: string;
};
async function loadReview(batchId: unknown): Promise<PersistedReview> {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_checklist_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const review = data as PersistedReview;
  parseChecklistOutput(
    JSON.stringify(review.proposal),
    review.capability,
    review.taskHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(review.proposalDigest))
    throw new AiTrustError("untrusted_proposal");
  return review;
}
export async function readChecklistReview(
  batchId: unknown,
): Promise<ChecklistReview> {
  const review = await loadReview(batchId);
  return {
    batchId: review.batchId,
    taskTitle: review.taskTitle,
    items: review.items,
    status: review.status,
  };
}

/** This endpoint receives UNTRUSTED model output, not approved operations. */
export async function finalizeTaskChecklist(
  requestId: unknown,
  rawOutput: unknown,
): Promise<ChecklistReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data: r, error } = await client
    .from("ai_requests")
    .select(
      "id,task_id,task_handle,source_revision,capability,status,expires_at",
    )
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();
  if (
    error ||
    !r ||
    r.status !== "prepared" ||
    Date.parse(r.expires_at) <= Date.now() ||
    !r.task_id
  )
    throw new AiTrustError("request_unavailable");
  const context = await readTaskChecklistContext(r.task_id);
  if (context.revision !== r.source_revision)
    throw new AiTrustError("source_changed");
  const proposal = parseChecklistOutput(rawOutput, r.capability, r.task_handle);
  const existing = new Set(
    context.existingChecklistTitles.map((i) => i.trim().toLowerCase()),
  );
  if (proposal.items.some((i) => existing.has(i.toLowerCase())))
    throw new AiTrustError("duplicate_checklist_items");
  const result = await client.rpc(
    "ai_record_checklist_proposal",
    signAiCommand(userId, "record_checklist", { request_id: r.id, proposal }),
  );
  if (result.error || typeof result.data !== "string")
    throw new AiTrustError("proposal_not_recorded");
  return readChecklistReview(result.data);
}

export async function approveTaskChecklist(batchId: unknown) {
  const { userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  if (review.status !== "proposed" && review.status !== "committed")
    throw new AiTrustError("proposal_unavailable");
  return applyReviewedTaskChecklist(
    signAiCommand(userId, "approve_checklist", {
      batch_id: review.batchId,
      proposal_digest: review.proposalDigest,
    }),
  );
}
export async function rejectTaskChecklist(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  const { error } = await client.rpc(
    "ai_reject_checklist",
    signAiCommand(userId, "reject_checklist", { batch_id: review.batchId }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
