import "server-only";
import { schoolIntelligenceUnavailable } from "./school-intelligence-policy";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  COURSE_MATERIAL_SUMMARY_CAPABILITY,
  COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY,
  courseMaterialSummaryPrompt,
  courseMaterialStudyQuestionsPrompt,
  parseCourseMaterialSummaryOutput,
  parseCourseMaterialStudyQuestionsOutput,
} from "./course-material-intelligence-contract";
import { AiTrustError, uuid } from "./trust-contract";

export async function prepareCourseMaterialIntelligence(
  inputPayload: string,
  kind: "material_summary" | "material_study_questions",
  provider: string,
  model: string,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();

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

  const { data: materials, error: matErr } = await client
    .from("course_materials")
    .select("id,title,material_type,content")
    .in("id", validIds)
    .eq("user_id", userId);

  if (matErr || !materials || materials.length === 0) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `mat_${randomUUID()}`;

  const formattedMaterials = materials.map((m) => ({
    title: m.title,
    type: m.material_type,
    content: m.content || "",
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

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: capabilityId,
    source_handle: handle,
    file_name: `material_${kind}.json`,
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

export async function finalizeCourseMaterialIntelligence(
  requestId: string,
  kind: "material_summary" | "material_study_questions",
  rawOutput: unknown,
) {
  schoolIntelligenceUnavailable();
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
  if (kind === "material_summary") {
    proposal = parseCourseMaterialSummaryOutput(rawOutput, request.capability, request.source_handle);
  } else {
    proposal = parseCourseMaterialStudyQuestionsOutput(rawOutput, request.capability, request.source_handle);
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

