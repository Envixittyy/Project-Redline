import "server-only";
import { schoolIntelligenceUnavailable } from "./school-intelligence-policy";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  QUICK_CAPTURE_CAPABILITY,
  quickCapturePrompt,
  parseQuickCaptureOutput,
  type ProposedTaskCapture,
  type ProposedEventCapture,
} from "./quick-capture-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { createTask } from "@/services/tasks/task-repository";
import { createCalendarEvent } from "@/services/calendar-events/calendar-event-repository";

export async function prepareQuickCapture(
  rawText: string,
  provider: string,
  model: string,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const text = String(rawText || "").trim();
  if (!text) throw new AiTrustError("request_unavailable");

  const requestId = randomUUID();
  const handle = `qc_${randomUUID()}`;
  const today = new Date().toISOString().slice(0, 10);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const promptData = quickCapturePrompt(handle, text, today, timeZone);
  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: QUICK_CAPTURE_CAPABILITY.id,
    source_handle: handle,
    file_name: "quick_capture.json",
    source_text: sourceText,
    source_digest: sourceDigest,
    start_date: today,
    timeZone,
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

export async function finalizeQuickCapture(
  requestId: string,
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

  const proposal = parseQuickCaptureOutput(rawOutput, request.capability, request.source_handle);
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

export async function applyQuickCaptureTask(draft: ProposedTaskCapture) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();

  let courseId: string | null = null;
  if (draft.courseCode) {
    const { data: course } = await client
      .from("courses")
      .select("id")
      .ilike("code", draft.courseCode.trim())
      .eq("user_id", userId)
      .maybeSingle();

    if (course) courseId = course.id;
  }

  let dueAt: string | null = null;
  if (draft.dueDate && draft.dueTime) {
    dueAt = `${draft.dueDate}T${draft.dueTime}:00Z`;
  }

  const task = await createTask({
    title: draft.title,
    dueDate: draft.dueDate || null,
    dueAt,
    priority: draft.priority || "medium",
    courseId,
  });

  return { ok: true, task };
}

export async function applyQuickCaptureEvent(draft: ProposedEventCapture) {
  schoolIntelligenceUnavailable();
  const start = draft.startTime
    ? `${draft.startDate}T${draft.startTime}:00Z`
    : `${draft.startDate}T00:00:00Z`;
  const end = draft.endTime
    ? `${draft.endDate || draft.startDate}T${draft.endTime}:00Z`
    : draft.allDay
    ? `${draft.endDate || draft.startDate}T23:59:59Z`
    : start;

  const event = await createCalendarEvent({
    title: draft.title,
    start,
    end,
    allDay: draft.allDay,
    eventType: "event",
    source: "life_os",
    description: draft.location ? `Location: ${draft.location}` : null,
  });

  return { ok: true, event };
}
