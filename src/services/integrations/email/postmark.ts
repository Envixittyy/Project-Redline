import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeEmailText, type NormalizedInboundEmail } from "./normalized-email";

const payloadSchema = z.object({
  MessageID: z.string().min(1).max(300),
  FromFull: z.object({ Email: z.email().max(320) }),
  OriginalRecipient: z.email().max(320),
  Subject: z.string().max(1000),
  Date: z.string().max(100),
  TextBody: z.string().max(128_000).default(""),
  HtmlBody: z.string().max(128_000).default(""),
  Headers: z.array(z.object({ Name: z.string().max(100), Value: z.string().max(4000) })).max(100).default([]),
});

/** Postmark's documented inbound verification mechanism is HTTP Basic over HTTPS. */
export function verifyPostmarkAuthorization(header: string | null, username: string, password: string): boolean {
  if (!username || password.length < 32 || !header) return false;
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return timingSafeEqual(createHash("sha256").update(header).digest(), createHash("sha256").update(expected).digest());
}

export function normalizePostmarkEmail(payload: unknown, receivedAt = new Date().toISOString()): NormalizedInboundEmail {
  const value = payloadSchema.parse(payload);
  const header = (name: string) => {
    const values = value.Headers.filter(h => h.Name.toLowerCase() === name);
    return values.length === 1 ? values[0].Value : null;
  };
  // Require aligned DKIM evidence from Postmark's SpamAssassin result. SPF alone
  // can authenticate an unrelated envelope sender; duplicate headers fail closed.
  const spamTests = header("x-spam-tests")?.split(/[,\s]+/) ?? [];
  const normalizedText = normalizeEmailText(value.TextBody, value.HtmlBody);
  const date = /(?:[+-]\d{2}:?\d{2}|GMT|UTC|Z)\s*$/i.test(value.Date) ? Date.parse(value.Date) : NaN;
  return {
    provider: "postmark", sourceMessageId: value.MessageID,
    originalMessageId: header("message-id"),
    sender: value.FromFull.Email.toLowerCase(), recipient: value.OriginalRecipient.toLowerCase(),
    subject: value.Subject, receivedAt,
    sentAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
    text: value.TextBody, html: value.HtmlBody, normalizedText,
    deliveryAuthenticated: spamTests.includes("DKIM_VALID_AU") && header("x-spam-status")?.toLowerCase().startsWith("no") === true,
    forwarded: /^(?:(?:fw|fwd):\s*)+/i.test(value.Subject) || /(?:forwarded message|original message|^From:)/im.test(normalizedText),
  };
}
