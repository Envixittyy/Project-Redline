import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  COURSE_MATERIAL_SUMMARY_CAPABILITY,
  COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY,
  courseMaterialSummaryPrompt,
  courseMaterialStudyQuestionsPrompt,
  parseCourseMaterialSummaryOutput,
  parseCourseMaterialStudyQuestionsOutput,
  type CourseMaterialSummaryReview,
  type CourseMaterialStudyQuestionsReview,
} from "./course-material-intelligence-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareCourseMaterialIntelligence(
  inputPayload: string,
  kind: "material_summary" | "material_study_questions",
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }

  let payload: {
    materialIds: string[];
  };

  try {
    payload = JSON.parse(inputPayload);
  } catch {
    throw new AiTrustError("request_unavailable");
  }

  const validIds = (payload.materialIds || []).slice(0, 3).map(uuid);
  if (validIds.length === 0) throw new AiTrustError("request_unavailable");

  // Query using real DB schema: id, user_id, course_id, title, type, description, url
  const { data: materials, error: matErr } = await client
    .from("course_materials")
    .select("id,course_id,title,type,description")
    .in("id", validIds)
    .eq("user_id", userId);

  // Every requested ID must resolve to the owner and same course
  if (matErr || !materials || materials.length !== validIds.length) {
    throw new AiTrustError("request_unavailable");
  }

  const firstCourseId = materials[0].course_id;
  if (materials.some((m) => m.course_id !== firstCourseId)) {
    throw new AiTrustError("request_unavailable");
  }

  const requestId = randomUUID();
  const handle = `mat_${randomUUID().replaceAll("-", "")}`;

  const formattedMaterials = materials.map((m) => ({
    title: m.title,
    type: m.type,
    content: m.description || "",
  }));

  let promptData;
  let capabilityId: string;

  if (kind === "material_summary") {
    promptData = courseMaterialSummaryPrompt(handle, formattedMaterials);
    capabilityId = COURSE_MATERIAL_SUMMARY_CAPABILITY.id;
  } else {
    promptData = courseMaterialStudyQuestionsPrompt(handle, formattedMaterials);
    capabilityId = COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id;
  }

  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
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
      file_name: `material_${kind}.json`,
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

export async function readCourseMaterialSummaryReview(batchId: unknown): Promise<CourseMaterialSummaryReview> {
  const r = await loadScopedReview(batchId);
  const proposal = parseCourseMaterialSummaryOutput(JSON.stringify(r.input), r.capability, r.sourceHandle);
  return {
    batchId: r.batchId,
    overview: proposal.overview,
    keyConcepts: proposal.keyConcepts,
    practicalTakeaways: proposal.practicalTakeaways,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function readCourseMaterialStudyQuestionsReview(batchId: unknown): Promise<CourseMaterialStudyQuestionsReview> {
  const r = await loadScopedReview(batchId);
  const proposal = parseCourseMaterialStudyQuestionsOutput(JSON.stringify(r.input), r.capability, r.sourceHandle);
  return {
    batchId: r.batchId,
    questions: proposal.questions,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function finalizeCourseMaterialIntelligence(
  requestId: string,
  kind: "material_summary" | "material_study_questions",
  rawOutput: unknown,
) {
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
  if (kind === "material_summary") {
    proposal = parseCourseMaterialSummaryOutput(rawOutput, request.capability, request.source_handle);
  } else {
    proposal = parseCourseMaterialStudyQuestionsOutput(rawOutput, request.capability, request.source_handle);
  }

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: `Course Material: ${kind}`,
      target_entity: "course_material",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  if (kind === "material_summary") return readCourseMaterialSummaryReview(result.data);
  return readCourseMaterialStudyQuestionsReview(result.data);
}
