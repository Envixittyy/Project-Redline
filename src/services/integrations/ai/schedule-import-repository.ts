import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { createValidatedImageSource, prepareImageDisclosure, type ImageRoute } from "./image-disclosure";
import { parseScheduleExtraction, parseScheduleReview, SCHEDULE_IMAGE_CAPABILITY, type ScheduleEdit, type ScheduleReview } from "./school-schedule-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";

async function command(operation: string, data: Record<string, unknown>) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(`ai_${operation}`, signAiCommand(userId, operation === "apply_school_schedule" ? `approve_scoped:${SCHEDULE_IMAGE_CAPABILITY.id}` : operation, data));
  if (result.error) throw new AiTrustError(result.error.message.includes("permission") ? "permission_denied" : result.error.message.includes("source_changed") ? "source_changed" : "request_unavailable");
  return result.data;
}
export async function prepareScheduleImport(formData: FormData, route: ImageRoute) {
  const file = formData.get("file"); if (!(file instanceof File)) throw new AiTrustError("invalid_request");
  const image = await createValidatedImageSource(file, SCHEDULE_IMAGE_CAPABILITY.id);
  const disclosure = await prepareImageDisclosure(image.imageId, SCHEDULE_IMAGE_CAPABILITY.id, route);
  const requestId = await command("prepare_school_screenshot", { image_id: image.imageId, disclosure_id: disclosure.disclosureId, capability: SCHEDULE_IMAGE_CAPABILITY.id, provider: route.provider, model: route.model, location: route.location, file_name: file.name, time_zone: resolveTimeZone() });
  if (typeof requestId !== "string") throw new AiTrustError("request_not_prepared");
  return { requestId, handle: "trusted_image", payloadDigest: image.digest, bytes: image.byteCount, disclosureId: disclosure.disclosureId };
}
async function loadReview(batchId: unknown): Promise<ScheduleReview> {
  const { client } = await requireAuthenticatedSupabase(); const { data, error } = await client.rpc("ai_read_scoped_review", { p_batch_id: uuid(batchId) });
  if (error || !data || data.capability !== SCHEDULE_IMAGE_CAPABILITY.id) throw new AiTrustError("untrusted_proposal");
  const proposal = parseScheduleReview(data.input, data.capability, data.sourceHandle);
  return { batchId: data.batchId, courses: proposal.courses, status: data.status, sourceHandle: data.sourceHandle, fileName: data.fileName, provenance: data.provenance };
}
export const readScheduleImportReview = loadReview;
export async function finalizeScheduleImport(requestId: string, rawOutput: unknown): Promise<ScheduleReview> {
  const { client, userId } = await requireAuthenticatedSupabase(); const { data: request, error } = await client.from("ai_scoped_requests").select("id,source_handle,capability,status,expires_at").eq("id", uuid(requestId)).eq("user_id", userId).maybeSingle();
  if (error || !request || request.status !== "prepared" || Date.parse(request.expires_at) <= Date.now()) throw new AiTrustError("request_unavailable");
  const extracted = parseScheduleExtraction(rawOutput, request.capability, request.source_handle);
  const proposal = { schema_version: 1, type: "review_schedule_import", source_handle: request.source_handle, courses: extracted.courses.map(course => ({ ...course, decision: "IGNORE" as const })) };
  const batchId = await command("record_school_screenshot", { request_id: request.id, proposal });
  if (typeof batchId !== "string") throw new AiTrustError("proposal_not_recorded"); return loadReview(batchId);
}
export async function reviseScheduleImport(batchId: unknown, edits: ScheduleEdit[]): Promise<ScheduleReview> {
  const safe = edits.map(({ targetFingerprint: _ignored, ...edit }: ScheduleEdit & { targetFingerprint?: string }) => edit);
  const next = await command("revise_school_screenshot", { batch_id: uuid(batchId), courses: safe });
  if (typeof next !== "string") throw new AiTrustError("proposal_unavailable"); return loadReview(next);
}
export async function applyScheduleImport(batchId: unknown) { const data = await command("apply_school_schedule", { batch_id: uuid(batchId) }); return { ok: true, ...(data as object) }; }
