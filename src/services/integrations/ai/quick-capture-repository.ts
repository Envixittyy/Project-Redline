import "server-only";
import { schoolIntelligenceUnavailable } from "./school-intelligence-policy";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  QUICK_CAPTURE_CAPABILITY,
  quickCapturePrompt,
  parseQuickCaptureOutput,
  type QuickCaptureReview,
} from "./quick-capture-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareQuickCapture(
  rawText: string,
  provider: unknown,
  model: unknown,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }
  const text = String(rawText || "").trim();
  if (!text) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `qc_${randomUUID().replaceAll("-", "")}`;
  const timeZone = resolveTimeZone();
  const today = todayIn(timeZone);

  const promptData = quickCapturePrompt(handle, text, today, timeZone);
  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: QUICK_CAPTURE_CAPABILITY.id,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: "quick_capture.json",
      start_date: today,
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
  schoolIntelligenceUnavailable();
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const proposal = parseQuickCaptureOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return { ...data, proposal } as QuickCaptureReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}

export async function readQuickCaptureReview(
  batchId: unknown,
): Promise<QuickCaptureReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    proposal: r.proposal,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function finalizeQuickCapture(
  requestId: string,
  rawOutput: unknown,
): Promise<QuickCaptureReview> {
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

  const proposal = parseQuickCaptureOutput(rawOutput, request.capability, request.source_handle);

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: `Quick Capture: ${proposal.captured.entityType}`,
      target_entity: proposal.captured.entityType === "task" ? "task" : "event",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  return readQuickCaptureReview(result.data);
}

export async function applyQuickCapture(batchId: unknown) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);

  const { data, error } = await client.rpc(
    "apply_ai_quick_capture",
    signAiCommand(userId, "approve_quick_capture", {
      batch_id: review.batchId,
      proposal_digest: review.proposalDigest,
    }),
  );

  if (error || !data) {
    throw new AiTrustError("request_unavailable");
  }

  return { ok: true, ...data };
}

export async function rejectQuickCapture(batchId: unknown) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", { batch_id: uuid(batchId) }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
