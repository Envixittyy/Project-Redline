import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { validatePrivateCompanionOrigin, validateLoopbackUrl } from "@/companion/network-policy";
import { validateConfiguredOrigin } from "@/companion/security";
import { signCompanionTicket, ticketDigest } from "@/companion/request-ticket";
import { AiTrustError, uuid } from "./trust-contract";
import { loadInferenceAttempt } from "./inference-router";
import { readInferenceSource } from "./inference-source";
import { localSelection } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

async function sign(path: string, body: unknown, token: unknown, deviceId: unknown, capability: "session" | "taskChecklist.propose" | "courseImport.propose" | "schoolAssessmentPrediction.propose") {
  const { userId } = await requireAuthenticatedSupabase();
  const audience = process.env.NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN;
  const origin = process.env.APP_ORIGIN;
  const key = process.env.COMPANION_REQUEST_SIGNING_KEY;
  if (!audience || !origin || !validateConfiguredOrigin(origin) || !key) throw new AiTrustError("remote_not_configured");
  validatePrivateCompanionOrigin(audience);
  if (token !== null && (typeof token !== "string" || !/^fwd_comp_[a-f0-9]{64}$/.test(token))) throw new AiTrustError("pairing_invalid");
  return signCompanionTicket(key, { audience, origin, userId, deviceId: uuid(deviceId), path, bodyDigest: ticketDigest(body), tokenHash: ticketDigest(token), capability });
}
export async function remoteSessionTicket(path: unknown, body: unknown, token: unknown, deviceId: unknown) {
  await requireAuthenticatedSupabase();
  if (!["/health", "/pair", "/unpair", "/v1/status"].includes(String(path))) throw new AiTrustError("capability_denied");
  const v = body as Record<string, unknown>;
  if (path === "/health") { if (body !== null || token !== null) throw new AiTrustError("invalid_request"); }
  else {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new AiTrustError("invalid_request");
    if (path === "/pair") {
      if (Object.keys(v).length !== 1 || typeof v.pairingSecret !== "string" || !/^[a-f0-9]{64}$/.test(v.pairingSecret) || token !== null) throw new AiTrustError("invalid_request");
    } else if (path === "/unpair") {
      if (Object.keys(v).length) throw new AiTrustError("invalid_request");
    } else {
      if (Object.keys(v).some(k => !["provider", "endpoint"].includes(k))) throw new AiTrustError("invalid_request");
      localSelection({ provider: v.provider, model: "status", location: "remote_local" });
      if (typeof v.endpoint !== "string") throw new AiTrustError("invalid_request");
      validateLoopbackUrl(v.endpoint);
    }
  }
  return sign(path as string, body, token, deviceId, "session");
}
export async function remoteInferenceTicket(id: unknown, endpoint: unknown, token: unknown, deviceId: unknown) {
  const a = await loadInferenceAttempt(id);
  if (a.location !== "remote_local" || a.status !== "dispatching" || typeof endpoint !== "string") throw new AiTrustError("capability_denied");
  const source = await readInferenceSource(a.kind, a.requestId, a.model);
  if (source.digest !== a.payload_digest) throw new AiTrustError("source_changed");
  const body = { provider: a.provider, endpoint: validateLoopbackUrl(endpoint).toString(), request: source.inference };
  const capability = a.kind === "checklist" ? "taskChecklist.propose" : a.kind === "course" ? "courseImport.propose" :
    a.kind === "assessment_prediction" ? "schoolAssessmentPrediction.propose" : null;
  if (!capability) throw new AiTrustError("capability_denied");
  const ticket = await sign("/v1/infer", body, token, deviceId, capability);
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("ai_claim_remote_ticket", signAiCommand(userId, "claim_remote_ticket", { id: a.id }));
  if (error) throw new AiTrustError("request_unavailable");
  return ticket;
}
