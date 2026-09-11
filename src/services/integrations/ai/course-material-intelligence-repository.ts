import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { AiTrustError, uuid } from "./trust-contract";
import { strictJson, strictObject } from "./strict-output";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";
import {
  scopedFailure,
  readProductReview,
  recordInformationalReview,
} from "./scoped-product-repository";
import {
  COURSE_MATERIAL_SUMMARY_CAPABILITY,
  COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY,
  parseCourseMaterialSummaryOutput,
  parseCourseMaterialStudyQuestionsOutput,
  type CourseMaterialSummaryReview,
  type CourseMaterialStudyQuestionsReview,
} from "./course-material-intelligence-contract";
function selectedCapability(kind: unknown) {
  if (kind === "material_summary") return COURSE_MATERIAL_SUMMARY_CAPABILITY.id;
  if (kind === "material_study_questions")
    return COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id;
  throw new AiTrustError("capability_denied");
}
export async function prepareCourseMaterialIntelligence(
  input: string,
  kind: "material_summary" | "material_study_questions",
  provider: unknown,
  model: unknown,
) {
  const p = strictObject(strictJson(input, 1024), ["materialIds"]);
  if (
    !Array.isArray(p.materialIds) ||
    p.materialIds.length < 1 ||
    p.materialIds.length > 3
  )
    throw new AiTrustError("request_unavailable");
  const ids = p.materialIds.map(uuid);
  if (new Set(ids).size !== ids.length)
    throw new AiTrustError("request_unavailable");
  const selection = ids.map((id) => ({ kind: "course_material", id }));
  const question = null;
  const capability = selectedCapability(kind);
  if (!validInferenceProvider(provider, model))
    throw new AiTrustError("invalid_provider");
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_prepare_informational",
    signAiCommand(userId, "prepare_informational", {
      capability,
      selection,
      question,
      provider,
      model,
      time_zone: resolveTimeZone(),
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return { requestId: result.data as string };
}
export async function readCourseMaterialSummaryReview(
  batchId: unknown,
): Promise<CourseMaterialSummaryReview> {
  const r = await readProductReview(
    batchId,
    COURSE_MATERIAL_SUMMARY_CAPABILITY.id,
  );
  const proposal = parseCourseMaterialSummaryOutput(
    JSON.stringify(r.input),
    r.capability,
    r.sourceHandle,
  );
  return { ...r, ...proposal, proposal };
}
export async function readCourseMaterialStudyQuestionsReview(
  batchId: unknown,
): Promise<CourseMaterialStudyQuestionsReview> {
  const r = await readProductReview(
    batchId,
    COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id,
  );
  const proposal = parseCourseMaterialStudyQuestionsOutput(
    JSON.stringify(r.input),
    r.capability,
    r.sourceHandle,
  );
  return { ...r, ...proposal, proposal };
}
export async function finalizeCourseMaterialIntelligence(
  requestId: string,
  kind: "material_summary" | "material_study_questions",
  raw: unknown,
) {
  const cap = selectedCapability(kind);
  const id = await recordInformationalReview(
    requestId,
    cap,
    raw,
    kind === "material_summary"
      ? parseCourseMaterialSummaryOutput
      : parseCourseMaterialStudyQuestionsOutput,
  );
  return kind === "material_summary"
    ? readCourseMaterialSummaryReview(id)
    : readCourseMaterialStudyQuestionsReview(id);
}
