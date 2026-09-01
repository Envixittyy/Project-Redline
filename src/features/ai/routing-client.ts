"use client";
import { inferLocalContent, LocalCompanionClientError, companionDeviceId } from "@/services/integrations/ai/companion-client";
import type { LocalCompanionConfig } from "@/services/integrations/ai/types";
import { mayFallback, routingMessage, type RequestKind, type RoutedPreparation } from "@/services/integrations/ai/routing-contract";
import { prepareRoutedInferenceAction, claimLocalInferenceAction, finalizeLocalInferenceAction, sendCloudInferenceAction, failLocalInferenceAction, cancelInferenceAction, prepareFallbackAction } from "./routing-actions";
import { remoteInferenceTicketAction } from "./remote-companion-actions";

export type CloudConsent = (prepared: RoutedPreparation) => Promise<boolean>;
// Native dialog: no persistent approval or implicit on-mount transfer.
export const confirmCloudTransfer: CloudConsent = async p => window.confirm(
  `Send once to ${p.provider.toUpperCase()} (${p.model})?\n\nPurpose: ${p.disclosure.purpose}\nPrivate source: ${p.disclosure.sources} selected item\nFields: ${p.disclosure.fields.join(", ")}\nBounded request: ${p.disclosure.bytes} bytes\nExpires: ${p.disclosure.expiresAt}\n\nProvider terms: ${p.disclosure.privacyUrl}\nOpenRouter may use its downstream model host; provider/model fallbacks are disabled there.\n\nOK sends this exact request once. Cancel sends nothing. Proposed changes need separate review and approval.`,
);
function failure(code: string) { return { ok: false as const, code, message: routingMessage(code) }; }
export async function generateRoutedProposal(kind: RequestKind, input: unknown, config: LocalCompanionConfig | null, signal?: AbortSignal, consent: CloudConsent = confirmCloudTransfer) {
  const local = config ? { provider: config.provider, model: config.model, location: config.companionUrl.startsWith("https:") ? "remote_local" : "local" } : null;
  const first = await prepareRoutedInferenceAction(kind, input, local);
  if (!first.ok) return first;
  let p = first.prepared;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) { await cancelInferenceAction(p.attemptId); return failure("cancelled"); }
    let failed;
    if (p.location === "cloud") {
      if (p.model !== "unconfigured" && !(await consent(p))) { await cancelInferenceAction(p.attemptId); return failure("cancelled"); }
      if (signal?.aborted) { await cancelInferenceAction(p.attemptId); return failure("cancelled"); }
      const result = await sendCloudInferenceAction(p.attemptId);
      if (result.ok) return result;
      failed = result;
    } else {
      try {
        if (!config) throw new LocalCompanionClientError("Not paired.", "local_unavailable");
        const claim = await claimLocalInferenceAction(p.attemptId, {
          companionUrl: config.companionUrl,
          endpoint: config.endpoint,
          pairingToken: config.pairingToken ?? "",
          deviceId: companionDeviceId(),
        });
        if (!claim.ok) return claim;
        let ticket: string | undefined = claim.ticket;
        if (p.location === "remote_local" && !ticket) {
          const authorization = await remoteInferenceTicketAction(p.attemptId, config.endpoint, config.pairingToken ?? null, companionDeviceId());
          if (!authorization.ok) return failure("pairing_invalid");
          ticket = authorization.ticket;
        }
        const raw = await inferLocalContent(config, claim.inference, signal, ticket);
        if (signal?.aborted) return failure("cancelled");
        // Invalid output is terminal, never a reason to send private data elsewhere.
        return await finalizeLocalInferenceAction(p.attemptId, raw);
      } catch (e) {
        const code = e instanceof LocalCompanionClientError ? e.code : "invalid_output";
        const recorded = await failLocalInferenceAction(p.attemptId, code);
        if (!recorded.ok) return recorded;
        failed = failure(code);
      }
    }
    if (signal?.aborted || !mayFallback(failed.code, p.location)) return failed;
    const fallback = await prepareFallbackAction(p.attemptId);
    if (!fallback.ok) return failed;
    p = fallback.prepared;
  }
  return failure("provider_unavailable");
}
