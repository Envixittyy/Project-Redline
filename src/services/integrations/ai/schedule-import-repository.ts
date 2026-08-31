import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { validateImageBuffer } from "@/services/documents/image-validator";
import {
  parseScheduleOutput,
  schedulePrompt,
  SCHEDULE_IMAGE_CAPABILITY,
  type ProposedCourseSchedule,
  type ScheduleProposal,
  type ScheduleReview,
} from "./school-schedule-contract";
import { AiTrustError, uuid } from "./trust-contract";

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export async function prepareScheduleImport(
  formData: FormData,
  provider: string,
  model: string,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const file = formData.get("file") as File | null;
  if (!file) throw new AiTrustError("invalid_request");

  const buffer = Buffer.from(await file.arrayBuffer());
  const validatedImage = validateImageBuffer(buffer, file.name, file.type);

  const requestId = randomUUID();
  const handle = `schedule_image_${randomUUID()}`;
  const sourceText = validatedImage.dataUrl;
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const promptData = schedulePrompt(handle, validatedImage.base64, validatedImage.mimeType);

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Store in ai_course_requests for lifecycle/audit tracking
  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: SCHEDULE_IMAGE_CAPABILITY.id,
    source_handle: handle,
    file_name: validatedImage.fileName,
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
    payloadDigest,
    bytes: validatedImage.byteLength,
    expiresAt,
  };
}

export async function finalizeScheduleImport(
  requestId: string,
  rawOutput: unknown,
): Promise<ScheduleReview> {
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

  const proposal = parseScheduleOutput(
    rawOutput,
    SCHEDULE_IMAGE_CAPABILITY.id,
    request.source_handle,
  );

  const batchId = randomUUID();

  // Create operation batch for immutable review
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
    action_type: SCHEDULE_IMAGE_CAPABILITY.outputType,
    input: proposal,
  });

  if (stepError) throw new AiTrustError("request_unavailable");

  return {
    batchId,
    courses: proposal.courses,
    status: "proposed",
    sourceHandle: request.source_handle,
    fileName: request.file_name,
  };
}

export type ScheduleApplyInput = {
  batchId: string;
  courses: Array<{
    code: string;
    title: string;
    section?: string;
    matchedCourseId?: string;
    color?: string;
    meetings: Array<{
      weekday: string;
      startTime: string;
      endTime: string;
      room?: string;
    }>;
  }>;
};

export async function applyScheduleImport(input: ScheduleApplyInput) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const batchId = uuid(input.batchId);

  const { data: batch, error: batchErr } = await client
    .from("operation_batches")
    .select("id,status,ai_course_request_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (batchErr || !batch || batch.status !== "proposed") {
    throw new Error("Invalid or already applied schedule import batch.");
  }

  const createdCourseIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  for (const courseItem of input.courses) {
    let courseId = courseItem.matchedCourseId;

    if (!courseId) {
      const { data: newCourse, error: courseErr } = await client
        .from("courses")
        .insert({
          user_id: userId,
          code: courseItem.code.trim(),
          name: courseItem.title.trim(),
          color: courseItem.color || "oklch(62% 0.19 255)",
        })
        .select("id")
        .single();

      if (courseErr || !newCourse) {
        throw new Error(`Failed to create course ${courseItem.code}: ${courseErr?.message}`);
      }
      courseId = newCourse.id;
      createdCourseIds.push(courseId);
    }

    for (const meeting of courseItem.meetings) {
      const weekdayNum = WEEKDAY_MAP[meeting.weekday.toLowerCase()] ?? 1;
      const { error: meetErr } = await client.from("course_meetings").insert({
        user_id: userId,
        course_id: courseId,
        title: courseItem.section ? `${courseItem.title} (${courseItem.section})` : courseItem.title,
        weekdays: [weekdayNum],
        start_date: today,
        start_time: meeting.startTime,
        end_time: meeting.endTime,
        time_zone: timeZone,
        location: meeting.room || null,
      });

      if (meetErr) {
        console.error("Failed to insert meeting:", meetErr);
      }
    }
  }

  await client
    .from("operation_batches")
    .update({ status: "committed" })
    .eq("id", batchId)
    .eq("user_id", userId);

  return { ok: true, createdCourseIds };
}
