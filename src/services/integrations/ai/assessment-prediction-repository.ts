import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import {
  ASSESSMENT_PREDICTION_CAPABILITY, parseAssessmentPredictionOutput,
  type AssessmentPredictionReview, type ProposedPrediction,
} from "./assessment-prediction-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { strictObject } from "./strict-output";
import { validInferenceProvider, isCloud } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

const capability = ASSESSMENT_PREDICTION_CAPABILITY.id;
function failure(message?: string): never {
  if (message?.includes("ai_source_changed") || message?.includes("ai_source_unavailable")) throw new AiTrustError("source_changed");
  if (message?.includes("ai_permission_denied")) throw new AiTrustError("permission_denied");
  throw new AiTrustError("request_unavailable");
}

export async function prepareAssessmentPredictions(selection: unknown, provider: unknown, model: unknown) {
  const selected = strictObject(selection, ["courseId", "syllabusMaterialId"]);
  const courseId = uuid(selected.courseId), syllabusId = uuid(selected.syllabusMaterialId);
  if (!validInferenceProvider(provider, model) || isCloud(provider)) throw new AiTrustError("capability_denied");
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_prepare_school_predictions", signAiCommand(userId, "prepare_school_predictions", {
    course_id: courseId, syllabus_material_id: syllabusId, provider, model, time_zone: resolveTimeZone(),
  }));
  if (result.error || typeof result.data !== "string") failure(result.error?.message);
  return { requestId: result.data as string };
}

export async function readAssessmentPredictionReview(batchId: unknown): Promise<AssessmentPredictionReview> {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", { p_batch_id: uuid(batchId) });
  if (error || !data || data.trustVersion !== 2 || data.capability !== capability ||
    !/^[a-f0-9]{64}$/.test(data.reviewDigest)) throw new AiTrustError("untrusted_proposal");
  const proposal = parseAssessmentPredictionOutput(JSON.stringify(data.input), capability, data.sourceHandle);
  return { batchId: data.batchId, predictions: proposal.predictions, status: data.status,
    sourceHandle: data.sourceHandle, expiresAt: data.expiresAt, provenance: data.provenance };
}

/** Only the existing local routing finalizer calls this; output remains untrusted relay data. */
export async function finalizeAssessmentPredictions(requestId: string, rawOutput: unknown): Promise<AssessmentPredictionReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data: r, error } = await client.from("ai_scoped_requests")
    .select("id,source_handle,capability,trust_version,status,expires_at,provider")
    .eq("id", uuid(requestId)).eq("user_id", userId).maybeSingle();
  if (error || !r || r.trust_version !== 2 || r.capability !== capability || r.status !== "prepared" ||
    isCloud(r.provider) || Date.parse(r.expires_at) <= Date.now()) throw new AiTrustError("request_unavailable");
  const proposal = parseAssessmentPredictionOutput(rawOutput, capability, r.source_handle);
  const result = await client.rpc("ai_record_school_predictions", signAiCommand(userId, "record_scoped_proposal", {
    request_id: r.id, proposal,
  }));
  if (result.error || typeof result.data !== "string") failure(result.error?.message);
  return readAssessmentPredictionReview(result.data);
}

export async function reviseAssessmentPredictions(batchId: unknown, editedPredictions: ProposedPrediction[]): Promise<AssessmentPredictionReview> {
  const review = await readAssessmentPredictionReview(batchId);
  const proposal = parseAssessmentPredictionOutput(JSON.stringify({
    schema_version: 1, type: "propose_assessment_predictions", source_handle: review.sourceHandle, predictions: editedPredictions,
  }), capability, review.sourceHandle);
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_revise_school_predictions", signAiCommand(userId, "revise_scoped_proposal", {
    batch_id: review.batchId, proposal,
  }));
  if (result.error || typeof result.data !== "string") failure(result.error?.message);
  return readAssessmentPredictionReview(result.data);
}

export async function applyAssessmentPredictions(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_apply_school_predictions", signAiCommand(userId, `approve_scoped:${capability}`, {
    batch_id: uuid(batchId),
  }));
  if (result.error || result.data?.ok !== true) failure(result.error?.message);
  return { ok: true as const };
}

export async function rejectAssessmentPredictions(batchId: unknown) {
  const review = await readAssessmentPredictionReview(batchId);
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("ai_reject_scoped_proposal", signAiCommand(userId, "reject_scoped_proposal", { batch_id: review.batchId }));
  if (error) failure(error.message);
}
