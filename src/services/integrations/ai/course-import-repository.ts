import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isModelId } from "@/companion/network-policy";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { applyReviewedCourseImport } from "@/services/courses/course-repository";
import {
  extractTextFromBuffer,
  MAX_DOCUMENT_BYTES,
} from "@/services/documents/text-extractor";
import { AiTrustError, uuid } from "./trust-contract";
import {
  COURSE_IMPORT_CAPABILITY,
  courseImportPrompt,
  parseCourseImportOutput,
  validateCourseDraft,
  type CourseImportReview,
} from "./course-import-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareCourseImport(
  form: FormData,
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  if (
    typeof provider !== "string" ||
    !["ollama", "llamacpp", "openai_compatible"].includes(provider) ||
    !isModelId(model)
  )
    throw new AiTrustError("invalid_provider");
  const file = form instanceof FormData ? form.get("file") : null;
  if (!(file instanceof File) || !file.size || file.size > MAX_DOCUMENT_BYTES)
    throw new AiTrustError("invalid_document");
  const source = extractTextFromBuffer(await file.arrayBuffer(), file.name);
  const handle = `document_${randomUUID().replaceAll("-", "")}`;
  courseImportPrompt(source.text, handle); // Reject excessive encoded context before persistence.
  const timeZone = resolveTimeZone(),
    requestId = randomUUID();
  const { error } = await client.rpc(
    "ai_create_course_request",
    signAiCommand(userId, "prepare_course", {
      id: requestId,
      source_handle: handle,
      source_text: source.text,
      file_name: source.fileName,
      source_digest: createHash("sha256").update(source.text).digest("hex"),
      capability: COURSE_IMPORT_CAPABILITY.id,
      provider,
      model,
      start_date: todayIn(timeZone),
      time_zone: timeZone,
    }),
  );
  if (error) throw new AiTrustError("request_not_prepared");
  const { data: r, error: readError } = await client
    .from("ai_course_requests")
    .select("source_text,source_handle,model,start_date,time_zone")
    .eq("id", requestId)
    .eq("user_id", userId)
    .single();
  if (readError || !r) throw new AiTrustError("request_unavailable");
  return {
    requestId,
    inference: {
      ...courseImportPrompt(r.source_text, r.source_handle),
      model: r.model,
    },
    startDate: r.start_date,
    timeZone: r.time_zone,
  };
}

async function loadReview(batchId: unknown) {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_course_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const proposal = parseCourseImportOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest))
    throw new AiTrustError("untrusted_proposal");
  return { ...data, proposal: proposal.course } as CourseImportReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}
export async function readCourseImportReview(
  batchId: unknown,
): Promise<CourseImportReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    proposal: r.proposal,
    fileName: r.fileName,
    startDate: r.startDate,
    timeZone: r.timeZone,
    status: r.status,
  };
}
export async function finalizeCourseImport(requestId: unknown, raw: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data: r, error } = await client
    .from("ai_course_requests")
    .select(
      "id,source_text,source_digest,source_handle,capability,status,expires_at",
    )
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();
  if (
    error ||
    !r ||
    r.status !== "prepared" ||
    Date.parse(r.expires_at) <= Date.now()
  )
    throw new AiTrustError("request_unavailable");
  if (
    createHash("sha256").update(r.source_text).digest("hex") !== r.source_digest
  )
    throw new AiTrustError("source_changed");
  const proposal = parseCourseImportOutput(raw, r.capability, r.source_handle);
  const result = await client.rpc(
    "ai_record_course_proposal",
    signAiCommand(userId, "record_course", { request_id: r.id, proposal }),
  );
  if (result.error || typeof result.data !== "string")
    throw new AiTrustError("proposal_not_recorded");
  return readCourseImportReview(result.data);
}
export async function reviseCourseImport(batchId: unknown, edited: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  const proposal = {
    schema_version: 1,
    type: "create_course",
    source_handle: review.sourceHandle,
    course: validateCourseDraft(edited),
  };
  const result = await client.rpc(
    "ai_revise_course_proposal",
    signAiCommand(userId, "revise_course", {
      batch_id: review.batchId,
      proposal,
    }),
  );
  if (result.error || typeof result.data !== "string")
    throw new AiTrustError("proposal_unavailable");
  return readCourseImportReview(result.data);
}
export async function approveCourseImport(batchId: unknown) {
  const { userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  return applyReviewedCourseImport(
    signAiCommand(userId, "approve_course", {
      batch_id: review.batchId,
      proposal_digest: review.proposalDigest,
    }),
  );
}
export async function rejectCourseImport(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_course_proposal",
    signAiCommand(userId, "reject_course", { batch_id: uuid(batchId) }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
