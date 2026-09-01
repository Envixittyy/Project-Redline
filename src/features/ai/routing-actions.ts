"use server";
import { AiTrustError } from "@/services/integrations/ai/trust-contract";
import { routingMessage, type RequestKind } from "@/services/integrations/ai/routing-contract";
import { prepareRoutedInference, claimLocalInference, finalizeLocalInference, sendCloudInference, failLocalInference, cancelInference, prepareFallback } from "@/services/integrations/ai/inference-router";

function failure(e: unknown) {
  const code = e instanceof AiTrustError ? e.code : "ai_unavailable";
  return { ok: false as const, code, message: routingMessage(code) };
}
export async function prepareRoutedInferenceAction(kind: RequestKind, input: unknown, local: unknown) {
  try { return { ok: true as const, prepared: await prepareRoutedInference(kind, input, local) }; } catch (e) { return failure(e); }
}
export async function claimLocalInferenceAction(id: unknown, transport?: { companionUrl: string; endpoint: string; pairingToken: string; deviceId: string }) {
  try { return { ok: true as const, ...(await claimLocalInference(id, transport)) }; } catch (e) { return failure(e); }
}
export async function finalizeLocalInferenceAction(id: unknown, raw: unknown) {
  try { return { ok: true as const, review: await finalizeLocalInference(id, raw) }; } catch (e) { return failure(e); }
}
export async function sendCloudInferenceAction(id: unknown) {
  try { return { ok: true as const, review: await sendCloudInference(id) }; } catch (e) { return failure(e); }
}
export async function failLocalInferenceAction(id: unknown, code: unknown) {
  try { await failLocalInference(id, code); return { ok: true as const }; } catch (e) { return failure(e); }
}
export async function cancelInferenceAction(id: unknown) {
  try { await cancelInference(id); return { ok: true as const }; } catch (e) { return failure(e); }
}
export async function prepareFallbackAction(id: unknown) {
  try { return { ok: true as const, prepared: await prepareFallback(id) }; } catch (e) { return failure(e); }
}
