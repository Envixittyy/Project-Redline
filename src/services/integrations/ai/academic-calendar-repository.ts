import "server-only";
import { createHash } from "node:crypto";
import { resolveTimeZone } from "@/lib/date/day";
import { applyTrustedAcademicCalendarReview } from "@/services/calendar-events/calendar-event-repository";
import { extractTextFromBuffer } from "@/services/documents/text-extractor";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { ACADEMIC_CALENDAR_CAPABILITY, parseAcademicCalendarOutput, type AcademicCalendarEdit, type AcademicCalendarReview, type AcademicCalendarReviewItem } from "./academic-calendar-contract";
import { ACADEMIC_CALENDAR_FORMATS, parseAcademicCsv, parseAcademicIcs, resolveExtractedAcademicEntries, type AcademicCalendarFormat, type CanonicalAcademicEvent, type ResolvedAcademicEntry } from "./academic-calendar-parser";
import { createValidatedImageSource, prepareImageDisclosure, type ImageRoute } from "./image-disclosure";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";

export type AcademicCalendarSource = { id: string; label: string; format: AcademicCalendarFormat; currentRevisionId: string | null; updatedAt: string };
type PreparedAcademicImport = { requestId: string; sourceId: string; revisionId: string; handle: string; payloadDigest: string; bytes: number; disclosureId?: string };

function formatOf(file: File): AcademicCalendarFormat {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const format = extension === "jpg" ? "jpeg" : extension;
  if (!format || !ACADEMIC_CALENDAR_FORMATS.includes(format as AcademicCalendarFormat)) throw new AiTrustError("invalid_request");
  const expected: Record<AcademicCalendarFormat, string[]> = {
    ics: ["", "application/octet-stream", "text/calendar", "text/plain"], csv: ["", "application/octet-stream", "text/csv", "text/plain"],
    txt: ["", "application/octet-stream", "text/plain"], md: ["", "application/octet-stream", "text/markdown", "text/plain"],
    png: ["image/png"], jpeg: ["image/jpeg"], webp: ["image/webp"],
  };
  if (!expected[format as AcademicCalendarFormat].includes(file.type)) throw new AiTrustError("invalid_request");
  return format as AcademicCalendarFormat;
}

function sourceSelection(formData: FormData) {
  const sourceIdValue = formData.get("sourceId"), labelValue = formData.get("sourceLabel");
  const sourceId = sourceIdValue === null || sourceIdValue === "" ? null : uuid(sourceIdValue);
  if (typeof labelValue !== "string" || labelValue !== labelValue.trim() || labelValue.length < 1 || labelValue.length > 120) throw new AiTrustError("invalid_request");
  return { sourceId, label: labelValue };
}

async function command(operation: string, data: Record<string, unknown>) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(`ai_${operation}`, signAiCommand(userId, operation, data));
  if (result.error) {
    const message = result.error.message;
    throw new AiTrustError(message.includes("source_changed") ? "source_changed" : message.includes("privacy") ? "cloud_privacy_denied" : "request_unavailable");
  }
  return result.data;
}

async function prepareRevision(formData: FormData, route?: ImageRoute): Promise<{ prepared: PreparedAcademicImport; format: AcademicCalendarFormat; normalizedText: string | null }> {
  const file = formData.get("file"); if (!(file instanceof File)) throw new AiTrustError("invalid_request");
  const format = formatOf(file), { sourceId, label } = sourceSelection(formData), timeZone = resolveTimeZone();
  let normalizedText: string | null = null, contentDigest: string, bytes: number, imageId: string | null = null, disclosureId: string | null = null;
  let provider = "server_parser", model = "deterministic-v2", location = "server";
  if (["png", "jpeg", "webp"].includes(format)) {
    if (!route) throw new AiTrustError("invalid_provider");
    const image = await createValidatedImageSource(file, ACADEMIC_CALENDAR_CAPABILITY.id);
    const disclosure = await prepareImageDisclosure(image.imageId, ACADEMIC_CALENDAR_CAPABILITY.id, route);
    contentDigest = image.digest; bytes = image.byteCount; imageId = image.imageId; disclosureId = disclosure.disclosureId;
    provider = route.provider; model = route.model; location = route.location;
  } else {
    const extracted = await extractTextFromBuffer(Buffer.from(await file.arrayBuffer()), file.name, file.type);
    normalizedText = extracted.text; contentDigest = createHash("sha256").update(normalizedText).digest("hex"); bytes = Buffer.byteLength(normalizedText);
    if (format === "txt" || format === "md") { if (!route) throw new AiTrustError("invalid_provider"); provider = route.provider; model = route.model; location = route.location; }
  }
  const result = await command("prepare_academic_calendar", {
    source_id: sourceId, label, format, content_digest: contentDigest, normalized_text: normalizedText, image_id: imageId, disclosure_id: disclosureId,
    provider, model, location, file_name: file.name, time_zone: timeZone,
    provenance: { version: 1, parser: format === "ics" || format === "csv" ? "bounded_deterministic_v2" : "strict_reviewed_extraction" },
  }) as Record<string, unknown> | null;
  if (!result || typeof result.requestId !== "string" || typeof result.sourceId !== "string" || typeof result.revisionId !== "string" || typeof result.sourceHandle !== "string") throw new AiTrustError("request_not_prepared");
  return { format, normalizedText, prepared: { requestId: result.requestId, sourceId: result.sourceId, revisionId: result.revisionId,
    handle: result.sourceHandle, payloadDigest: contentDigest, bytes, ...(disclosureId ? { disclosureId } : {}) } };
}

async function record(requestId: string, entries: ResolvedAcademicEntry[]) {
  const batchId = await command("record_academic_calendar", { request_id: uuid(requestId), entries });
  if (typeof batchId !== "string") throw new AiTrustError("proposal_not_recorded");
  return readAcademicCalendarReview(batchId);
}

export async function listAcademicCalendarSources(): Promise<AcademicCalendarSource[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("academic_calendar_import_sources").select("id,label,format,current_revision_id,updated_at")
    .eq("user_id", userId).eq("status", "active").order("updated_at", { ascending: false });
  if (error) throw new AiTrustError("request_unavailable");
  return (data ?? []).map((row) => ({ id: row.id, label: row.label, format: row.format as AcademicCalendarFormat,
    currentRevisionId: row.current_revision_id, updatedAt: row.updated_at }));
}

/** ICS and CSV never enter an inference route or disclosure path. */
export async function prepareDeterministicAcademicCalendarImport(formData: FormData): Promise<AcademicCalendarReview> {
  const { prepared, format, normalizedText } = await prepareRevision(formData);
  if (!normalizedText || (format !== "ics" && format !== "csv")) throw new AiTrustError("invalid_request");
  return record(prepared.requestId, format === "ics" ? parseAcademicIcs(normalizedText, resolveTimeZone()) : parseAcademicCsv(normalizedText, resolveTimeZone()));
}

/** Routed preparation is restricted to TXT, MD and validated image formats. */
export async function prepareAcademicCalendarImport(formData: FormData, route: ImageRoute) {
  const { prepared, format } = await prepareRevision(formData, route);
  if (format === "ics" || format === "csv") throw new AiTrustError("invalid_request");
  return prepared;
}

function event(value: unknown): CanonicalAcademicEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiTrustError("untrusted_proposal");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "allDay,description,end,eventType,start,title" || typeof v.title !== "string" || !(v.description === null || typeof v.description === "string") ||
      typeof v.start !== "string" || typeof v.end !== "string" || typeof v.allDay !== "boolean" || typeof v.eventType !== "string") throw new AiTrustError("untrusted_proposal");
  return v as CanonicalAcademicEvent;
}

export async function readAcademicCalendarReview(batchId: unknown): Promise<AcademicCalendarReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", { p_batch_id: uuid(batchId) });
  const input = data?.input as Record<string, unknown> | undefined;
  if (error || !data || data.capability !== ACADEMIC_CALENDAR_CAPABILITY.id || !input || input.type !== "review_academic_calendar_import" || !Array.isArray(input.events) || !Array.isArray(input.skipped) || typeof input.revisionId !== "string") throw new AiTrustError("untrusted_proposal");
  const { data: revision } = await client.from("academic_calendar_source_revisions").select("source_id,format").eq("id", input.revisionId).eq("user_id", userId).maybeSingle();
  if (!revision) throw new AiTrustError("source_changed");
  const { data: source } = await client.from("academic_calendar_import_sources").select("label,current_revision_id").eq("id", revision.source_id).eq("user_id", userId).maybeSingle();
  if (!source || source.current_revision_id !== input.revisionId) throw new AiTrustError("source_changed");
  const events: AcademicCalendarReviewItem[] = input.events.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AiTrustError("untrusted_proposal");
    const item = raw as Record<string, unknown>;
    return { entryId: uuid(item.entryId), operation: item.operation as AcademicCalendarReviewItem["operation"], decision: item.decision as AcademicCalendarReviewItem["decision"],
      source: event(item.source), reviewed: event(item.reviewed), current: item.current === null ? null : event(item.current), baseline: item.baseline === null ? null : event(item.baseline),
      canonicalEventId: item.canonicalEventId === null ? null : uuid(item.canonicalEventId), note: item.note === null ? null : String(item.note) };
  });
  return { batchId: data.batchId, sourceId: revision.source_id, sourceLabel: source.label, revisionId: input.revisionId, format: revision.format,
    events, skipped: input.skipped, status: data.status, sourceHandle: data.sourceHandle, fileName: data.fileName, provenance: data.provenance } as AcademicCalendarReview;
}

export async function finalizeAcademicCalendarImport(requestId: string, rawOutput: unknown): Promise<AcademicCalendarReview> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data: request, error } = await client.from("ai_scoped_requests").select("id,source_handle,capability,status,expires_at,time_zone,source_manifest")
    .eq("id", uuid(requestId)).eq("user_id", userId).maybeSingle();
  if (error || !request || request.status !== "prepared" || Date.parse(request.expires_at) <= Date.now()) throw new AiTrustError("request_unavailable");
  const revisionId = request.source_manifest?.[0]?.id;
  const { data: revision } = await client.from("academic_calendar_source_revisions").select("format,normalized_text").eq("id", revisionId).eq("user_id", userId).maybeSingle();
  if (!revision || !["txt", "md", "png", "jpeg", "webp"].includes(revision.format)) throw new AiTrustError("source_changed");
  const extraction = parseAcademicCalendarOutput(rawOutput, request.capability, request.source_handle, revision.format, request.time_zone);
  return record(request.id, resolveExtractedAcademicEntries(revision.format, revision.normalized_text, extraction.events));
}

export async function reviseAcademicCalendar(batchId: unknown, edits: AcademicCalendarEdit[]): Promise<AcademicCalendarReview> {
  const safe = edits.map((edit) => ({ entryId: uuid(edit.entryId), decision: edit.decision, event: event(edit.event) }));
  const next = await command("revise_academic_calendar", { batch_id: uuid(batchId), edits: safe });
  if (typeof next !== "string") throw new AiTrustError("proposal_unavailable");
  return readAcademicCalendarReview(next);
}

/** The Calendar repository is the only application boundary allowed to mutate canonical events. */
export async function applyAcademicCalendarImport(batchId: unknown) { return applyTrustedAcademicCalendarReview(uuid(batchId)); }

export async function rejectAcademicCalendarImport(batchId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("ai_reject_scoped_proposal", signAiCommand(userId, "reject_scoped_proposal", { batch_id: uuid(batchId) }));
  if (error) throw new AiTrustError("proposal_unavailable");
}
