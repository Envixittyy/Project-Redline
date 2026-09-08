import { z } from "zod";
import { LocalAdapterError, readBoundedResponseText } from "@/companion/adapters/runtime-adapter";
import { resolveTimeZone } from "@/lib/date/day";
import { normalizePostmarkEmail, verifyPostmarkAuthorization } from "@/services/integrations/email/postmark";
import { parseBlackboardEmail } from "@/services/integrations/blackboard/email-parser";
import { ingestSchoolEvent } from "@/services/school/school-ingestion";
import { getSupabaseAdminClient } from "@/services/supabase/admin";

export const runtime = "nodejs";
const list = (value: string | undefined) => value?.split(",").map(v => v.trim().toLowerCase()).filter(Boolean) ?? [];

export async function POST(request: Request) {
  const userId = process.env.SCHOOL_EMAIL_OWNER_ID;
  const recipient = process.env.SCHOOL_EMAIL_RECIPIENT?.trim().toLowerCase();
  const senders = list(process.env.SCHOOL_BLACKBOARD_SENDERS);
  const forwarders = list(process.env.SCHOOL_EMAIL_FORWARDERS);
  const hosts = list(process.env.SCHOOL_BLACKBOARD_HOSTS);
  if (!z.uuid().safeParse(userId).success || !z.email().safeParse(recipient).success || !senders.length || !hosts.length || !process.env.POSTMARK_WEBHOOK_USERNAME || (process.env.POSTMARK_WEBHOOK_PASSWORD?.length ?? 0) < 32) {
    return Response.json({ ok: false, code: "not_configured" }, { status: 503 });
  }
  if (!verifyPostmarkAuthorization(request.headers.get("authorization"), process.env.POSTMARK_WEBHOOK_USERNAME!, process.env.POSTMARK_WEBHOOK_PASSWORD!)) {
    return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415 });
  try {
    const raw = await readBoundedResponseText(new Response(request.body, { headers: request.headers }), 512 * 1024);
    const email = normalizePostmarkEmail(JSON.parse(raw));
    if (email.recipient !== recipient) return Response.json({ ok: true, status: "ignored" });
    const event = parseBlackboardEmail(email, { senders, forwarders, hosts, timeZone: resolveTimeZone() });
    // This is the sole privileged ingress. Owner comes from deployment config,
    // never from the webhook, recipient suffix, browser session, or parsed text.
    const result = await ingestSchoolEvent(getSupabaseAdminClient(), userId!, event);
    console.info("[school-email]", { eventId: result.eventId, status: result.status, itemId: result.itemId });
    return Response.json({ ok: true, status: result.status });
  } catch (error) {
    const oversized = error instanceof LocalAdapterError && error.code === "response_too_large";
    const malformed = error instanceof SyntaxError || error instanceof z.ZodError;
    const code = oversized ? "payload_too_large" : malformed ? "malformed_payload" : "ingestion_failed";
    console.error("[school-email]", { code });
    return Response.json({ ok: false, code }, { status: oversized ? 413 : malformed ? 422 : 500 });
  }
}
