import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { extractTextFromBuffer } from "@/services/documents/text-extractor";
import { validateImageBuffer } from "@/services/documents/image-validator";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  ACADEMIC_CALENDAR_CAPABILITY,
  parseAcademicCalendarOutput,
  type AcademicCalendarReview,
  type ProposedAcademicEvent,
} from "./academic-calendar-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareAcademicCalendarImport(
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
  const isImage = ["image/png", "image/jpeg", "image/webp"].includes(file.type);

  let sourceText = "";
  let payloadBytes = buffer.length;
  let fileName = file.name;

  if (isImage) {
    const validatedImage = await validateImageBuffer(buffer, file.name, file.type);
    sourceText = validatedImage.dataUrl;
    payloadBytes = validatedImage.byteLength;
    fileName = validatedImage.fileName;
  } else {
    const extracted = await extractTextFromBuffer(buffer, file.name, file.type);
    sourceText = extracted.text;
    payloadBytes = Buffer.byteLength(extracted.text);
    fileName = extracted.fileName;
  }

  const requestId = randomUUID();
  const handle = `acad_cal_${randomUUID().replaceAll("-", "")}`;
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const timeZone = resolveTimeZone();
  const startDate = todayIn(timeZone);

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: ACADEMIC_CALENDAR_CAPABILITY.id,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: fileName,
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
    bytes: payloadBytes,
  };
}

async function loadReview(batchId: unknown) {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const proposal = parseAcademicCalendarOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return { ...data, events: proposal.events } as AcademicCalendarReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}

export async function readAcademicCalendarReview(
  batchId: unknown,
): Promise<AcademicCalendarReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    events: r.events,
    status: r.status,
    sourceHandle: r.sourceHandle,
    fileName: r.fileName,
    provenance: r.provenance,
  };
}

export async function finalizeAcademicCalendarImport(
  requestId: string,
  rawOutput: unknown,
): Promise<AcademicCalendarReview> {
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

  const proposal = parseAcademicCalendarOutput(
    rawOutput,
    request.capability,
    request.source_handle,
  );

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: `Academic Calendar Import: ${proposal.events.length} events`,
      target_entity: "academic_calendar",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  return readAcademicCalendarReview(result.data);
}

export async function reviseAcademicCalendar(
  batchId: unknown,
  editedEvents: ProposedAcademicEvent[],
): Promise<AcademicCalendarReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);
  const proposal = {
    schema_version: 1,
    type: "academic_calendar_proposal",
    source_handle: review.sourceHandle,
    events: editedEvents,
  };

  const result = await client.rpc(
    "ai_revise_scoped_proposal",
    signAiCommand(userId, "revise_scoped_proposal", {
      batch_id: review.batchId,
      proposal,
      summary: `Edited Academic Calendar: ${editedEvents.length} events`,
      target_entity: "academic_calendar",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_unavailable");
  }

  return readAcademicCalendarReview(result.data);
}

export async function applyAcademicCalendarImport(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const review = await loadReview(batchId);

  const { data, error } = await client.rpc(
    "apply_ai_academic_calendar",
    signAiCommand(userId, "approve_academic_calendar", {
      batch_id: review.batchId,
      proposal_digest: review.proposalDigest,
    }),
  );

  if (error || !data) {
    throw new AiTrustError("request_unavailable");
  }

  return { ok: true, ...data };
}

export async function rejectAcademicCalendarImport(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc(
    "ai_reject_scoped_proposal",
    signAiCommand(userId, "reject_scoped_proposal", { batch_id: uuid(batchId) }),
  );
  if (error) throw new AiTrustError("proposal_unavailable");
}
