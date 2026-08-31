import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { validateImageBuffer } from "@/services/documents/image-validator";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  BLACKBOARD_COURSE_IMAGE_CAPABILITY,
  parseBlackboardCourseOutput,
  type BlackboardCourseReview,
  type ProposedBlackboardCourse,
} from "./blackboard-screenshot-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareBlackboardScreenshotImport(
  formData: FormData,
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }
  const file = formData.get("file") as File | null;
  if (!file) throw new AiTrustError("invalid_request");

  const buffer = Buffer.from(await file.arrayBuffer());
  const validatedImage = await validateImageBuffer(buffer, file.name, file.type);

  const requestId = randomUUID();
  const handle = `bb_image_${randomUUID().replaceAll("-", "")}`;
  const sourceText = validatedImage.dataUrl;
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const timeZone = resolveTimeZone();
  const startDate = todayIn(timeZone);

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: validatedImage.fileName,
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
    payloadDigest: sourceDigest,
    bytes: validatedImage.byteLength,
  };
}

async function loadReview(batchId: unknown) {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const proposal = parseBlackboardCourseOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return { ...data, courses: proposal.courses } as BlackboardCourseReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}

export async function readBlackboardScreenshotReview(
  batchId: unknown,
): Promise<BlackboardCourseReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    courses: r.courses,
    status: r.status,
    sourceHandle: r.sourceHandle,
    fileName: r.fileName,
    provenance: r.provenance,
  };
}

export async function finalizeBlackboardScreenshotImport(
  requestId: string,
  rawOutput: unknown,
): Promise<BlackboardCourseReview> {
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

  const proposal = parseBlackboardCourseOutput(
    rawOutput,
    request.capability,
    request.source_handle,
  );

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: `Blackboard Courses Import: ${proposal.courses.length} courses`,
      target_entity: "course",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  return readBlackboardScreenshotReview(result.data);
}

export async function reviseBlackboardScreenshotImport(
  batchId: unknown,
  editedCourses: ProposedBlackboardCourse[],
): Promise<BlackboardCourseReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  const proposal = {
    schema_version: 1,
    type: "blackboard_course_proposal",
    source_handle: review.sourceHandle,
    courses: editedCourses,
  };

  const result = await client.rpc(
    "ai_revise_scoped_proposal",
    signAiCommand(userId, "revise_scoped_proposal", {
      batch_id: review.batchId,
      proposal,
      summary: `Edited Blackboard Courses: ${editedCourses.length} courses`,
      target_entity: "course",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_unavailable");
  }

  return readBlackboardScreenshotReview(result.data);
}

export async function applyBlackboardScreenshotImport(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);

  const { data, error } = await client.rpc(
    "apply_ai_blackboard_courses",
    signAiCommand(userId, "approve_blackboard_courses", {
      batch_id: review.batchId,
      proposal_digest: review.proposalDigest,
    }),
  );

  if (error || !data) {
    throw new AiTrustError("request_unavailable");
  }

  return { ok: true, ...data };
}

export async function rejectBlackboardScreenshotImport(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", { batch_id: uuid(batchId) }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
