import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  fetchResendReceivedEmail,
  normalizeResendEmail,
  verifyResendWebhook,
} from "./resend";

describe("Resend webhook signature verification", () => {
  const secretRaw = "test-secret-key-that-is-base64-encoded==";
  const secretBase64 = Buffer.from(secretRaw).toString("base64");
  const secretWithPrefix = `whsec_${secretBase64}`;
  const secretBytes = Buffer.from(secretBase64, "base64");

  const sign = (id: string, timestamp: string, payload: string, key = secretBytes) => {
    return createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  };

  it("verifies valid Svix signatures with whsec_ prefix and raw base64 secret", () => {
    const payload = JSON.stringify({ type: "email.received", data: { email_id: "em_123" } });
    const now = Math.floor(Date.now() / 1000);
    const id = "msg_123";
    const timestamp = String(now);
    const signature = `v1,${sign(id, timestamp, payload)}`;

    expect(verifyResendWebhook(payload, {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    }, secretWithPrefix)).toBe(true);

    expect(verifyResendWebhook(payload, {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    }, secretBase64)).toBe(true);
  });

  it("supports webhook-* header fallbacks", () => {
    const payload = '{"hello":"world"}';
    const now = Math.floor(Date.now() / 1000);
    const id = "msg_abc";
    const timestamp = String(now);
    const signature = `v1,${sign(id, timestamp, payload)}`;

    expect(verifyResendWebhook(payload, {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    }, secretWithPrefix)).toBe(true);
  });

  it("handles space-separated signature candidates (key rotation)", () => {
    const payload = '{"type":"test"}';
    const now = Math.floor(Date.now() / 1000);
    const id = "msg_rot";
    const timestamp = String(now);
    const validSig = sign(id, timestamp, payload);
    const multiHeader = `v1,staleSig v1,${validSig} v2,someOtherSig`;

    expect(verifyResendWebhook(payload, {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": multiHeader,
    }, secretWithPrefix)).toBe(true);
  });

  it("rejects altered payload or incorrect signature", () => {
    const payload = '{"data":"original"}';
    const now = Math.floor(Date.now() / 1000);
    const id = "msg_tamper";
    const timestamp = String(now);
    const signature = `v1,${sign(id, timestamp, payload)}`;

    expect(verifyResendWebhook('{"data":"tampered"}', {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    }, secretWithPrefix)).toBe(false);

    expect(verifyResendWebhook(payload, {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": "v1,invalidSignature",
    }, secretWithPrefix)).toBe(false);
  });

  it("enforces timestamp tolerance to prevent replay attacks", () => {
    const payload = '{"data":"replay"}';
    const id = "msg_replay";
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 305);
    const signature = `v1,${sign(id, oldTimestamp, payload)}`;

    expect(verifyResendWebhook(payload, {
      "svix-id": id,
      "svix-timestamp": oldTimestamp,
      "svix-signature": signature,
    }, secretWithPrefix)).toBe(false);
  });

  it("fails closed on missing headers or empty secret", () => {
    expect(verifyResendWebhook("{}", {}, secretWithPrefix)).toBe(false);
    expect(verifyResendWebhook("{}", { "svix-id": "1", "svix-timestamp": "2" }, secretWithPrefix)).toBe(false);
    expect(verifyResendWebhook("{}", { "svix-id": "1", "svix-timestamp": "2", "svix-signature": "v1,abc" }, "")).toBe(false);
  });
});

describe("Resend email normalization", () => {
  const sampleResendEmail = (overrides: Record<string, unknown> = {}) => ({
    object: "email",
    id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    from: "Blackboard <notifications@learn.example.edu>",
    to: ["school@inbound.example.com"],
    subject: "New assignment: Assignment 1",
    created_at: "2026-09-08T02:00:00.000Z",
    text: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: September 15, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/item?course_id=_101_1&content_id=_201_1",
    html: "",
    headers: {
      "message-id": "<msg-orig-123@learn.example.edu>",
      date: "Tue, 8 Sep 2026 10:00:00 +0800",
      "x-spam-status": "No",
      "x-spam-tests": "DKIM_VALID_AU",
      "authentication-results": "mx.resend.com; dkim=pass",
    },
    message_id: "<msg-orig-123@learn.example.edu>",
    ...overrides,
  });

  it("normalizes a valid Resend email payload", () => {
    const normalized = normalizeResendEmail(sampleResendEmail());
    expect(normalized).toMatchObject({
      provider: "resend",
      sourceMessageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
      originalMessageId: "<msg-orig-123@learn.example.edu>",
      sender: "notifications@learn.example.edu",
      recipient: "school@inbound.example.com",
      subject: "New assignment: Assignment 1",
      sentAt: "2026-09-08T02:00:00.000Z",
      deliveryAuthenticated: true,
      forwarded: false,
    });
    expect(normalized.normalizedText).toContain("Course: CS101");
  });

  it("supports array of header objects and top-level message_id", () => {
    const email = sampleResendEmail({
      headers: [
        { Name: "Message-ID", Value: "<rfc-header-1@learn.example.edu>" },
        { Name: "X-Spam-Status", Value: "No" },
        { Name: "X-Spam-Tests", Value: "DKIM_VALID_AU" },
      ],
      message_id: null,
    });
    const normalized = normalizeResendEmail(email);
    expect(normalized.originalMessageId).toBe("<rfc-header-1@learn.example.edu>");
    expect(normalized.deliveryAuthenticated).toBe(true);
  });

  it("preserves RFC Message-ID when present and defaults to null when missing", () => {
    const withRfc = normalizeResendEmail(sampleResendEmail({ message_id: "<abc@def.com>" }));
    expect(withRfc.originalMessageId).toBe("<abc@def.com>");

    const withoutRfc = normalizeResendEmail(sampleResendEmail({ message_id: null, headers: {} }));
    expect(withoutRfc.originalMessageId).toBeNull();
  });

  it("supports email_id alias for sourceMessageId", () => {
    const email = sampleResendEmail({ id: undefined, email_id: "email_custom_id" });
    const normalized = normalizeResendEmail(email);
    expect(normalized.sourceMessageId).toBe("email_custom_id");
  });

  it("correctly extracts email address from display name format", () => {
    const email = sampleResendEmail({
      from: '"John Doe, Instructor" <instructor@learn.example.edu>',
      to: "Forward School <school@inbound.example.com>",
    });
    const normalized = normalizeResendEmail(email);
    expect(normalized.sender).toBe("instructor@learn.example.edu");
    expect(normalized.recipient).toBe("school@inbound.example.com");
  });

  it("detects forwarded email patterns", () => {
    const fwdSubject = normalizeResendEmail(sampleResendEmail({ subject: "Fwd: New assignment" }));
    expect(fwdSubject.forwarded).toBe(true);

    const fwdBody = normalizeResendEmail(sampleResendEmail({
      text: "FYI\n---------- Forwarded message ---------\nFrom: Blackboard",
    }));
    expect(fwdBody.forwarded).toBe(true);

    const resentHeader = normalizeResendEmail(sampleResendEmail({
      headers: { "resent-from": "student@example.edu", "x-spam-status": "No", "x-spam-tests": "DKIM_VALID_AU" },
    }));
    expect(resentHeader.forwarded).toBe(true);
  });

  it("authenticates via Authentication-Results dkim=pass", () => {
    const email = sampleResendEmail({
      headers: {
        "authentication-results": "mx.resend.com; dkim=pass (good signature)",
      },
    });
    expect(normalizeResendEmail(email).deliveryAuthenticated).toBe(true);
  });

  it("rejects unauthenticated deliveries (spam, failed DKIM, or missing headers)", () => {
    const noHeaders = sampleResendEmail({ headers: {} });
    expect(normalizeResendEmail(noHeaders).deliveryAuthenticated).toBe(false);

    const spamEmail = sampleResendEmail({
      headers: {
        "x-spam-status": "Yes",
        "authentication-results": "dkim=pass",
      },
    });
    expect(normalizeResendEmail(spamEmail).deliveryAuthenticated).toBe(false);

    const dkimFailed = sampleResendEmail({
      headers: {
        "authentication-results": "mx.resend.com; dkim=fail (bad signature)",
      },
    });
    expect(normalizeResendEmail(dkimFailed).deliveryAuthenticated).toBe(false);
  });

  it("fails closed on malformed data", () => {
    expect(() => normalizeResendEmail({})).toThrow();
    expect(() => normalizeResendEmail({ from: "not-an-email", to: "valid@example.com" })).toThrow();
    expect(() => normalizeResendEmail({ from: "valid@example.com", to: "not-an-email" })).toThrow();
  });
});

describe("fetchResendReceivedEmail", () => {
  it("fetches received email with Authorization header and parses JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "em_123",
      from: "notifications@learn.example.edu",
      to: ["school@inbound.example.com"],
      text: "Assignment content",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const result = await fetchResendReceivedEmail("em_123", "re_test_key", { fetchFn: mockFetch });
    expect(result).toMatchObject({ id: "em_123" });
    expect(mockFetch).toHaveBeenCalledWith("https://api.resend.com/emails/receiving/em_123", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer re_test_key",
      }),
    }));
  });

  it("throws on HTTP error response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
    await expect(fetchResendReceivedEmail("em_missing", "re_test_key", { fetchFn: mockFetch })).rejects.toThrow("resend_api_request_failed_404");
  });

  it("fails on empty email ID or API key", async () => {
    await expect(fetchResendReceivedEmail("", "key")).rejects.toThrow("missing_email_id");
    await expect(fetchResendReceivedEmail("id", "")).rejects.toThrow("missing_api_key");
  });
});
