import { z } from "zod";
import { LocalAdapterError, readBoundedResponseText } from "@/companion/adapters/runtime-adapter";
import { resolveTimeZone } from "@/lib/date/day";
import {
  fetchResendReceivedEmail,
  normalizeResendEmail,
  resendWebhookEventSchema,
  verifyResendWebhook,
} from "@/services/integrations/email/resend";
import { parseBlackboardEmail } from "@/services/integrations/blackboard/email-parser";
import { ingestSchoolEvent } from "@/services/school/school-ingestion";
import { getSupabaseAdminClient } from "@/services/supabase/admin";

export const runtime = "nodejs";

const list = (value: string | undefined) =>
  value?.split(",").map(v => v.trim().toLowerCase()).filter(Boolean) ?? [];

export async function POST(request: Request) {
  const userId = process.env.SCHOOL_EMAIL_OWNER_ID;
  const recipient = process.env.SCHOOL_EMAIL_RECIPIENT?.trim().toLowerCase();
  const senders = list(process.env.SCHOOL_BLACKBOARD_SENDERS);
  const forwarders = list(process.env.SCHOOL_EMAIL_FORWARDERS);
  const hosts = list(process.env.SCHOOL_BLACKBOARD_HOSTS);
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (
    !z.uuid().safeParse(userId).success ||
    !z.email().safeParse(recipient).success ||
    !senders.length ||
    !hosts.length ||
    !webhookSecret ||
    webhookSecret.length < 10 ||
    !apiKey ||
    apiKey.length < 5
  ) {
    return Response.json({ ok: false, code: "not_configured" }, { status: 503 });
  }

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ ok: false, code: "invalid_content_type" }, { status: 415 });
  }

  try {
    const raw = await readBoundedResponseText(new Response(request.body, { headers: request.headers }), 512 * 1024);

    if (!verifyResendWebhook(raw, request.headers, webhookSecret)) {
      return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
    }

    const payload = JSON.parse(raw);
    const event = resendWebhookEventSchema.parse(payload);

    if (event.type !== "email.received") {
      return Response.json({ ok: true, status: "ignored" });
    }

    const eventData = event.data;
    const hasInlineBody = (
      typeof eventData.text === "string" ||
      typeof eventData.html === "string"
    );

    let emailPayload: unknown;
    if (hasInlineBody) {
      emailPayload = eventData;
    } else {
      const emailId = (eventData.email_id ?? eventData.id);
      if (typeof emailId !== "string" || !emailId.trim()) {
        return Response.json({ ok: false, code: "malformed_payload" }, { status: 422 });
      }
      emailPayload = await fetchResendReceivedEmail(emailId, apiKey);
    }

    const email = normalizeResendEmail(emailPayload);
    if (email.recipient !== recipient) {
      return Response.json({ ok: true, status: "ignored" });
    }

    const schoolEvent = parseBlackboardEmail(email, {
      senders,
      forwarders,
      hosts,
      timeZone: resolveTimeZone(),
    });

    const result = await ingestSchoolEvent(getSupabaseAdminClient(), userId!, schoolEvent);
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
