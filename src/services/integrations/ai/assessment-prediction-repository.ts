import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  ASSESSMENT_PREDICTION_CAPABILITY,
  assessmentPredictionPrompt,
  parseAssessmentPredictionOutput,
  type AssessmentPredictionReview,
  type ProposedPrediction,
} from "./assessment-prediction-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function prepareAssessmentPredictions(
  courseId: string,
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }
  const validCourseId = uuid(courseId);

  // 1. Load course
  const { data: course, error: courseErr } = await client
    .from("courses")
    .select("id,code,name")
    .eq("id", validCourseId)
    .eq("user_id", userId)
    .single();

  if (courseErr || !course) throw new AiTrustError("request_unavailable");

  // 2. Load meetings
  const { data: meetings } = await client
    .from("course_meetings")
    .select("weekdays,start_time,end_time,location")
    .eq("course_id", validCourseId)
    .eq("user_id", userId);

  const formattedMeetings = (meetings || []).flatMap((m) =>
    (m.weekdays || []).map((w: number) => ({
      weekday: WEEKDAY_NAMES[w] || "Monday",
      startTime: (m.start_time || "").slice(0, 5),
      endTime: (m.end_time || "").slice(0, 5),
      room: m.location,
    })),
  );

  // 3. Load syllabus text from course materials (correct schema columns: type, description, title)
  const { data: materials } = await client
    .from("course_materials")
    .select("title,type,description")
    .eq("course_id", validCourseId)
    .eq("user_id", userId);

  const syllabus = (materials || []).find(
    (mat) => mat.type === "syllabus" || mat.title.toLowerCase().includes("syllabus"),
  );
  const syllabusText = syllabus?.description || (materials || []).map((m) => `${m.title}:\n${m.description || ""}`).join("\n\n") || "No syllabus text uploaded.";

  // 4. Load academic calendar events
  const { data: calEvents } = await client
    .from("calendar_events")
    .select("title,starts_at,ends_at,event_type")
    .eq("user_id", userId)
    .eq("source", "academic_calendar")
    .order("starts_at");

  const academicEvents = (calEvents || []).map((e) => ({
    title: e.title,
    startDate: e.starts_at.slice(0, 10),
    endDate: e.ends_at ? e.ends_at.slice(0, 10) : undefined,
    eventType: e.event_type || "event",
  }));

  // 5. Load confirmed Blackboard events or tasks
  const { data: bbEvents } = await client
    .from("calendar_events")
    .select("title,starts_at")
    .eq("user_id", userId)
    .eq("source", "blackboard");

  const existingConfirmed = (bbEvents || []).map((b) => ({
    title: b.title,
    date: b.starts_at.slice(0, 10),
  }));

  const requestId = randomUUID();
  const handle = `pred_${randomUUID().replaceAll("-", "")}`;
  const promptData = assessmentPredictionPrompt(handle, {
    course,
    meetings: formattedMeetings,
    syllabusText,
    academicEvents,
    existingConfirmedAssessments: existingConfirmed,
  });

  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const timeZone = resolveTimeZone();
  const startDate = todayIn(timeZone);

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: ASSESSMENT_PREDICTION_CAPABILITY.id,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: `${course.code}_predictions.json`,
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
  const proposal = parseAssessmentPredictionOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return { ...data, predictions: proposal.predictions } as AssessmentPredictionReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}

export async function readAssessmentPredictionReview(
  batchId: unknown,
): Promise<AssessmentPredictionReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    predictions: r.predictions,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function finalizeAssessmentPredictions(
  requestId: string,
  rawOutput: unknown,
): Promise<AssessmentPredictionReview> {
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

  const proposal = parseAssessmentPredictionOutput(
    rawOutput,
    request.capability,
    request.source_handle,
  );

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: `Assessment Predictions: ${proposal.predictions.length} items`,
      target_entity: "assessment_prediction",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  return readAssessmentPredictionReview(result.data);
}

export async function reviseAssessmentPredictions(
  batchId: unknown,
  editedPredictions: ProposedPrediction[],
): Promise<AssessmentPredictionReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  const proposal = {
    schema_version: 1,
    type: "assessment_prediction_proposal",
    source_handle: review.sourceHandle,
    predictions: editedPredictions,
  };

  const result = await client.rpc(
    "ai_revise_scoped_proposal",
    signAiCommand(userId, "revise_scoped_proposal", {
      batch_id: review.batchId,
      proposal,
      summary: `Edited Assessment Predictions: ${editedPredictions.length} items`,
      target_entity: "assessment_prediction",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_unavailable");
  }

  return readAssessmentPredictionReview(result.data);
}

export async function applyAssessmentPredictions(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);

  const { data, error } = await client.rpc(
    "apply_ai_assessment_predictions",
    signAiCommand(userId, "approve_assessment_predictions", {
      batch_id: review.batchId,
      proposal_digest: review.proposalDigest,
    }),
  );

  if (error || !data) {
    throw new AiTrustError("request_unavailable");
  }

  return { ok: true, ...data };
}

export async function rejectAssessmentPredictions(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", { batch_id: uuid(batchId) }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
