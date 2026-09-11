import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";
export function scopedFailure(message?: string): never {
  if (/source_changed|source_unavailable/.test(message ?? ""))
    throw new AiTrustError("source_changed");
  if (message?.includes("permission_denied"))
    throw new AiTrustError("permission_denied");
  if (message?.includes("context_too_large"))
    throw new AiTrustError("context_too_large");
  throw new AiTrustError("request_unavailable");
}
export async function readProductReview(batchId: unknown, capability: string) {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (
    error ||
    !data ||
    data.trustVersion !== 2 ||
    data.capability !== capability ||
    !/^[a-f0-9]{64}$/.test(data.reviewDigest)
  )
    throw new AiTrustError("untrusted_proposal");
  return data;
}
export async function recordInformationalReview(
  requestId: string,
  capability: string,
  raw: unknown,
  parse: (raw: unknown, capability: string, handle: string) => unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data: r, error } = await client
    .from("ai_scoped_requests")
    .select("id,source_handle,capability,trust_version,status,expires_at")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();
  if (
    error ||
    !r ||
    r.trust_version !== 2 ||
    r.capability !== capability ||
    r.status !== "prepared" ||
    Date.parse(r.expires_at) <= Date.now()
  )
    throw new AiTrustError("request_unavailable");
  const proposal = parse(raw, capability, r.source_handle);
  const result = await client.rpc(
    "ai_record_informational",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: r.id,
      proposal,
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return result.data as string;
}
export async function recordNoteCaptureReview(
  requestId: string,
  capability: string,
  raw: unknown,
  parse: (raw: unknown, cap: string, handle: string) => unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data: r, error } = await client
    .from("ai_scoped_requests")
    .select("id,source_handle,capability,trust_version,status,expires_at")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();
  if (
    error ||
    !r ||
    r.trust_version !== 2 ||
    r.capability !== capability ||
    r.status !== "prepared" ||
    Date.parse(r.expires_at) <= Date.now()
  )
    throw new AiTrustError("request_unavailable");
  const result = await client.rpc(
    "ai_record_note_capture",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: r.id,
      proposal: parse(raw, capability, r.source_handle),
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return result.data as string;
}
export async function reviseProductReview(
  batchId: unknown,
  capability: string,
  proposal: unknown,
) {
  const r = await readProductReview(batchId, capability);
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_revise_current_mutation",
    signAiCommand(userId, "revise_scoped_proposal", {
      batch_id: r.batchId,
      proposal,
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return result.data as string;
}
