import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readBoundedResponseText } from "@/companion/adapters/runtime-adapter";
import { normalizeEmailText, type NormalizedInboundEmail } from "./normalized-email";

export interface ResendWebhookHeaders {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
}

const headerObjectSchema = z.object({
  name: z.string().max(100).optional(),
  Name: z.string().max(100).optional(),
  value: z.string().max(4000).optional(),
  Value: z.string().max(4000).optional(),
});

const resendInboundPayloadSchema = z.object({
  id: z.string().min(1).max(300).optional(),
  email_id: z.string().min(1).max(300).optional(),
  from: z.string().min(1).max(1000),
  to: z.union([
    z.string().min(1).max(1000),
    z.array(z.string().min(1).max(1000)).min(1),
  ]),
  subject: z.string().max(1000).default(""),
  created_at: z.string().max(100).optional(),
  text: z.string().max(128_000).nullable().optional(),
  html: z.string().max(128_000).nullable().optional(),
  headers: z.union([
    z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    z.array(headerObjectSchema),
  ]).optional(),
  message_id: z.string().max(500).nullable().optional(),
  messageId: z.string().max(500).nullable().optional(),
}).refine(data => Boolean(data.id || data.email_id), {
  message: "Missing Resend email identifier (id or email_id)",
});

export const resendWebhookEventSchema = z.object({
  type: z.string().min(1).max(100),
  created_at: z.string().max(100).optional(),
  data: z.record(z.string(), z.unknown()),
});

function getHeaderValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    const matched = headers.filter(h => ((h.Name ?? h.name)?.toLowerCase() === target));
    return matched.length === 1 ? (matched[0].Value ?? matched[0].value ?? null) : null;
  }
  if (typeof headers === "object") {
    const rec = headers as Record<string, unknown>;
    for (const [key, val] of Object.entries(rec)) {
      if (key.toLowerCase() === target) {
        if (typeof val === "string") return val;
        if (Array.isArray(val)) {
          const strVals = val.filter((v): v is string => typeof v === "string");
          return strVals.length === 1 ? strVals[0] : null;
        }
      }
    }
  }
  return null;
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^<>]+)>\s*$/);
  const addr = (match ? match[1] : raw).trim().toLowerCase();
  return z.email().max(320).parse(addr);
}

/**
 * Verifies Resend webhook signatures using the standard Svix webhook signature verification algorithm.
 * Svix signs webhooks using HMAC-SHA256 over `${svix_id}.${svix_timestamp}.${raw_payload}`.
 */
export function verifyResendWebhook(
  rawPayload: string,
  headers: Headers | ResendWebhookHeaders | Record<string, string | null | undefined>,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number }
): boolean {
  if (!secret || typeof secret !== "string") return false;

  const getHeader = (name: string): string | null => {
    if ("get" in headers && typeof headers.get === "function") {
      return headers.get(name);
    }
    const rec = headers as Record<string, string | null | undefined>;
    return rec[name] ?? rec[name.toLowerCase()] ?? null;
  };

  const id = getHeader("svix-id") ?? getHeader("webhook-id") ?? (headers as ResendWebhookHeaders).id ?? null;
  const timestamp = getHeader("svix-timestamp") ?? getHeader("webhook-timestamp") ?? (headers as ResendWebhookHeaders).timestamp ?? null;
  const signature = getHeader("svix-signature") ?? getHeader("webhook-signature") ?? (headers as ResendWebhookHeaders).signature ?? null;

  if (!id || !timestamp || !signature) return false;

  const secretKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretKey, "base64");
    if (secretBytes.length === 0) return false;
  } catch {
    return false;
  }

  const timestampNum = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampNum)) return false;

  const tolerance = options?.toleranceSeconds ?? 300;
  const nowSeconds = options?.now !== undefined
    ? Math.floor(options.now / 1000)
    : Math.floor(Date.now() / 1000);

  if (tolerance > 0 && Math.abs(nowSeconds - timestampNum) > tolerance) {
    return false;
  }

  const signedContent = `${id}.${timestamp}.${rawPayload}`;
  const expectedSignature = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  const candidates = signature.trim().split(/\s+/);
  for (const candidate of candidates) {
    const [version, sig] = candidate.split(",");
    if (version === "v1" && sig) {
      const sigBuffer = Buffer.from(sig, "utf8");
      if (expectedBuffer.length === sigBuffer.length && timingSafeEqual(expectedBuffer, sigBuffer)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalizes a Resend inbound email into the provider-neutral NormalizedInboundEmail shape.
 */
export function normalizeResendEmail(
  payload: unknown,
  receivedAt = new Date().toISOString()
): NormalizedInboundEmail {
  const value = resendInboundPayloadSchema.parse(payload);
  const sourceMessageId = (value.id ?? value.email_id)!.trim();

  const originalMessageId = (
    value.message_id?.trim() ||
    value.messageId?.trim() ||
    getHeaderValue(value.headers, "message-id")?.trim() ||
    null
  );

  const sender = extractEmailAddress(value.from);
  const recipientRaw = Array.isArray(value.to) ? value.to[0] : value.to;
  const recipient = extractEmailAddress(recipientRaw);

  const headerDate = getHeaderValue(value.headers, "date");
  let sentAt: string | null = null;
  if (headerDate && /(?:[+-]\d{2}:?\d{2}|GMT|UTC|Z)\s*$/i.test(headerDate)) {
    const parsed = Date.parse(headerDate);
    if (Number.isFinite(parsed)) {
      sentAt = new Date(parsed).toISOString();
    }
  }
  if (!sentAt && value.created_at) {
    const parsed = Date.parse(value.created_at);
    if (Number.isFinite(parsed)) {
      sentAt = new Date(parsed).toISOString();
    }
  }

  const textBody = value.text ?? "";
  const htmlBody = value.html ?? "";
  const normalizedText = normalizeEmailText(textBody, htmlBody);

  const hasForwardSubject = /^(?:(?:fw|fwd):\s*)+/i.test(value.subject);
  const hasForwardText = /(?:forwarded message|original message|^From:)/im.test(normalizedText);
  const hasResentHeader = Boolean(
    getHeaderValue(value.headers, "resent-from") ||
    getHeaderValue(value.headers, "resent-date")
  );
  const forwarded = hasForwardSubject || hasForwardText || hasResentHeader;

  const spamStatus = getHeaderValue(value.headers, "x-spam-status")?.toLowerCase();
  const spamTests = getHeaderValue(value.headers, "x-spam-tests")?.split(/[,\s]+/) ?? [];
  const authResults = getHeaderValue(value.headers, "authentication-results")?.toLowerCase() ?? "";

  const spamFailed = spamStatus?.startsWith("yes") === true;
  const dkimFailed = /\bdkim=fail\b/.test(authResults);
  const dkimValidAu = spamTests.includes("DKIM_VALID_AU") && spamStatus?.startsWith("no") === true;
  const dkimPassed = /\bdkim=pass\b/.test(authResults);

  const deliveryAuthenticated = !spamFailed && !dkimFailed && (dkimValidAu || dkimPassed);

  return {
    provider: "resend",
    sourceMessageId,
    originalMessageId,
    sender,
    recipient,
    subject: value.subject,
    receivedAt,
    sentAt,
    text: textBody,
    html: htmlBody,
    normalizedText,
    deliveryAuthenticated,
    forwarded,
  };
}

/**
 * Retrieves the full received email object from Resend's Receiving API.
 */
export async function fetchResendReceivedEmail(
  emailId: string,
  apiKey: string,
  options?: {
    fetchFn?: typeof fetch;
    maxBytes?: number;
    signal?: AbortSignal;
  }
): Promise<unknown> {
  const trimmedId = emailId.trim();
  const trimmedKey = apiKey.trim();
  if (!trimmedId) throw new Error("missing_email_id");
  if (!trimmedKey) throw new Error("missing_api_key");

  const customFetch = options?.fetchFn ?? fetch;
  const maxBytes = options?.maxBytes ?? 512 * 1024;
  const signal = options?.signal ?? AbortSignal.timeout(10000);

  const response = await customFetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(trimmedId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "User-Agent": "Forward-Project-Redline",
      },
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`resend_api_request_failed_${response.status}`);
  }

  const raw = await readBoundedResponseText(response, maxBytes);
  return JSON.parse(raw);
}
