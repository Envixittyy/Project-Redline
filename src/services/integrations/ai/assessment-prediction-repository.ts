import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  ASSESSMENT_PREDICTION_CAPABILITY,
  assessmentPredictionPrompt,
  parseAssessmentPredictionOutput,
  type AssessmentPredictionReview,
  type ProposedPrediction,
} from "./assessment-prediction-contract";
import { AiTrustError, uuid } from "./trust-contract";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function prepareAssessmentPredictions(
  courseId: string,
  provider: string,
  model: string,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
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

  // 3. Load syllabus text from course materials
  const { data: materials } = await client
    .from("course_materials")
    .select("title,material_type,content")
    .eq("course_id", validCourseId)
    .eq("user_id", userId);

  const syllabus = (materials || []).find(
    (mat) => mat.material_type === "syllabus" || mat.title.toLowerCase().includes("syllabus"),
  );
  const syllabusText = syllabus?.content || (materials || []).map((m) => `${m.title}:\n${m.content || ""}`).join("\n\n") || "No syllabus text uploaded.";

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
  const handle = `pred_${randomUUID()}`;
  const promptData = assessmentPredictionPrompt(handle, {
    course,
    meetings: formattedMeetings,
    syllabusText,
    academicEvents,
    existingConfirmedAssessments: existingConfirmed,
  });

  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: ASSESSMENT_PREDICTION_CAPABILITY.id,
    source_handle: handle,
    file_name: `${course.code}_predictions.json`,
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

export async function finalizeAssessmentPredictions(
  requestId: string,
  rawOutput: unknown,
): Promise<AssessmentPredictionReview> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: request, error: reqError } = await client
    .from("ai_course_requests")
    .select("id,source_handle,file_name,status,expires_at")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();

  if (reqError || !request || request.status !== "prepared") {
    throw new AiTrustError("request_unavailable");
  }

  const proposal = parseAssessmentPredictionOutput(
    rawOutput,
    ASSESSMENT_PREDICTION_CAPABILITY.id,
    request.source_handle,
  );

  const batchId = randomUUID();

  const { error: batchError } = await client.from("operation_batches").insert({
    id: batchId,
    user_id: userId,
    source: "ai",
    status: "proposed",
    ai_course_request_id: request.id,
  });

  if (batchError) throw new AiTrustError("request_unavailable");

  const { error: stepError } = await client.from("operation_steps").insert({
    id: randomUUID(),
    batch_id: batchId,
    user_id: userId,
    position: 0,
    action_type: ASSESSMENT_PREDICTION_CAPABILITY.outputType,
    input: proposal,
  });

  if (stepError) throw new AiTrustError("request_unavailable");

  return {
    batchId,
    predictions: proposal.predictions,
    status: "proposed",
    sourceHandle: request.source_handle,
  };
}

export type AssessmentPredictionApplyInput = {
  batchId: string;
  predictions: ProposedPrediction[];
};

export async function applyAssessmentPredictions(input: AssessmentPredictionApplyInput) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const batchId = uuid(input.batchId);

  const { data: batch, error: batchErr } = await client
    .from("operation_batches")
    .select("id,status,ai_course_request_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (batchErr || !batch || batch.status !== "proposed") {
    throw new Error("Invalid or already applied prediction batch.");
  }

  let savedCount = 0;

  for (const p of input.predictions) {
    const { error: insertErr } = await client.from("school_assessment_predictions").insert({
      user_id: userId,
      course_id: p.courseId,
      prediction_type: p.predictionType,
      title: p.title.trim(),
      predicted_date: p.predictedDate,
      predicted_time: p.predictedTime || null,
      confidence: p.confidence,
      status: "active",
      rationale: p.rationale.trim(),
      source_reference: p.sourceReference || null,
    });

    if (!insertErr) {
      savedCount++;
    } else {
      console.error("Failed to insert assessment prediction:", insertErr);
    }
  }

  await client
    .from("operation_batches")
    .update({ status: "committed" })
    .eq("id", batchId)
    .eq("user_id", userId);

  return { ok: true, count: savedCount };
}
