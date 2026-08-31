import "server-only";
import { schoolIntelligenceUnavailable } from "./school-intelligence-policy";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { extractTextFromBuffer } from "@/services/documents/text-extractor";
import { validateImageBuffer } from "@/services/documents/image-validator";
import {
  ACADEMIC_CALENDAR_CAPABILITY,
  academicCalendarPrompt,
  parseAcademicCalendarOutput,
  type AcademicCalendarReview,
  type ProposedAcademicEvent,
} from "./academic-calendar-contract";
import { AiTrustError, uuid } from "./trust-contract";

export async function prepareAcademicCalendarImport(
  formData: FormData,
  provider: string,
  model: string,
) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const file = formData.get("file") as File | null;
  if (!file) throw new AiTrustError("invalid_request");

  const buffer = Buffer.from(await file.arrayBuffer());
  const isImage = ["image/png", "image/jpeg", "image/webp"].includes(file.type);

  let promptData;
  let sourceText = "";
  let payloadBytes = buffer.length;

  if (isImage) {
    const validatedImage = await validateImageBuffer(buffer, file.name, file.type);
    promptData = academicCalendarPrompt(`acad_img_${randomUUID()}`, {
      image: { base64: validatedImage.base64, mimeType: validatedImage.mimeType },
    });
    sourceText = validatedImage.dataUrl;
    payloadBytes = validatedImage.byteLength;
  } else {
    const extracted = await extractTextFromBuffer(buffer, file.name, file.type);
    promptData = academicCalendarPrompt(`acad_doc_${randomUUID()}`, {
      text: extracted.text,
    });
    sourceText = extracted.text;
    payloadBytes = Buffer.byteLength(extracted.text);
  }

  const requestId = randomUUID();
  const handle = `acad_cal_${randomUUID()}`;

  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: ACADEMIC_CALENDAR_CAPABILITY.id,
    source_handle: handle,
    file_name: file.name,
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
    bytes: payloadBytes,
    expiresAt,
  };
}

export async function finalizeAcademicCalendarImport(
  requestId: string,
  rawOutput: unknown,
): Promise<AcademicCalendarReview> {
  schoolIntelligenceUnavailable();
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

  const proposal = parseAcademicCalendarOutput(
    rawOutput,
    ACADEMIC_CALENDAR_CAPABILITY.id,
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
    action_type: ACADEMIC_CALENDAR_CAPABILITY.outputType,
    input: proposal,
  });

  if (stepError) throw new AiTrustError("request_unavailable");

  return {
    batchId,
    events: proposal.events,
    status: "proposed",
    sourceHandle: request.source_handle,
    fileName: request.file_name,
  };
}

export type AcademicCalendarApplyInput = {
  batchId: string;
  events: ProposedAcademicEvent[];
};

export async function applyAcademicCalendarImport(input: AcademicCalendarApplyInput) {
  schoolIntelligenceUnavailable();
  const { client, userId } = await requireAuthenticatedSupabase();
  const batchId = uuid(input.batchId);

  const { data: batch, error: batchErr } = await client
    .from("operation_batches")
    .select("id,status,ai_course_request_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (batchErr || !batch || batch.status !== "proposed") {
    throw new Error("Invalid or already applied academic calendar batch.");
  }

  let importedCount = 0;

  for (const event of input.events) {
    const startsAt = event.startDate.includes("T")
      ? new Date(event.startDate).toISOString()
      : `${event.startDate}T00:00:00Z`;

    const endsAt = event.endDate
      ? event.endDate.includes("T")
        ? new Date(event.endDate).toISOString()
        : `${event.endDate}T23:59:59Z`
      : event.startDate.includes("T")
        ? new Date(new Date(event.startDate).getTime() + 60 * 60 * 1000).toISOString()
        : `${event.startDate}T23:59:59Z`;

    const externalId = `academic_cal_${createHash("sha256")
      .update(`${event.title}_${event.startDate}`)
      .digest("hex")
      .slice(0, 32)}`;

    // Upsert or insert calendar event with source 'academic_calendar'
    const { error: eventErr } = await client.from("calendar_events").upsert(
      {
        user_id: userId,
        title: event.title.trim(),
        description: event.description || null,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: event.allDay,
        event_type: event.eventType || "event",
        source: "academic_calendar",
        external_id: externalId,
      },
      { onConflict: "source,external_id" },
    );

    if (!eventErr) {
      importedCount++;
    } else {
      console.error("Failed to insert academic calendar event:", eventErr);
    }
  }

  await client
    .from("operation_batches")
    .update({ status: "committed" })
    .eq("id", batchId)
    .eq("user_id", userId);

  return { ok: true, count: importedCount };
}
