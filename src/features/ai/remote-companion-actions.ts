"use server";
import { remoteSessionTicket, remoteInferenceTicket } from "@/services/integrations/ai/remote-companion";
export async function remoteSessionTicketAction(path: unknown, body: unknown, token: unknown, deviceId: unknown) {
  try { return { ok: true as const, ticket: await remoteSessionTicket(path, body, token, deviceId) }; }
  catch { return { ok: false as const }; }
}
export async function remoteInferenceTicketAction(id: unknown, endpoint: unknown, token: unknown, deviceId: unknown) {
  try { return { ok: true as const, ticket: await remoteInferenceTicket(id, endpoint, token, deviceId) }; }
  catch { return { ok: false as const }; }
}
