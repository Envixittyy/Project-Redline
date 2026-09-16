import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/services/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));

import { POST } from "./route";

const owner = "11111111-1111-4111-8111-111111111111";
const secretRaw = "test-webhook-secret-key-long-enough-32bytes==";
const secretBase64 = Buffer.from(secretRaw).toString("base64");
const webhookSecret = `whsec_${secretBase64}`;
const apiKey = "re_test_api_key_12345";

function resendWebhookPayload(dataOverrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  return {
    type: "email.received",
    created_at: "2026-09-08T02:00:00.000Z",
    data: {
      email_id: "resend-delivery-1",
      created_at: "2026-09-08T02:00:00.000Z",
      from: "notifications@learn.example.edu",
      to: ["school@inbound.example.com"],
      subject: "New assignment: Assignment 1",
      message_id: "<orig-assignment-1@learn.example.edu>",
      text: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: September 15, 2026 at 11:59 PM Asia/Manila\nWeight: 15%\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1&utm_source=email",
      html: "",
      headers: {
        "x-spam-status": "No",
        "x-spam-tests": "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU",
        "message-id": "<orig-assignment-1@learn.example.edu>",
      },
      ...dataOverrides,
    },
    ...eventOverrides,
  };
}

function createSignedRequest(
  payload: unknown = resendWebhookPayload(),
  options: {
    headers?: Record<string, string>;
    secret?: string;
    timestamp?: string;
    id?: string;
  } = {}
) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = options.id ?? "svix_msg_1";
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secretKey = (options.secret ?? webhookSecret).replace(/^whsec_/, "");
  const keyBytes = Buffer.from(secretKey, "base64");
  const signature = `v1,${createHmac("sha256", keyBytes).update(`${id}.${timestamp}.${body}`).digest("base64")}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
    ...options.headers,
  };

  return new Request("https://forward.example.com/api/inbound/resend", {
    method: "POST",
    headers,
    body,
  });
}

describe("Resend authenticated inbound route", () => {
  beforeEach(() => {
    vi.stubEnv("SCHOOL_EMAIL_OWNER_ID", owner);
    vi.stubEnv("SCHOOL_EMAIL_RECIPIENT", "school@inbound.example.com");
    vi.stubEnv("SCHOOL_BLACKBOARD_SENDERS", "notifications@learn.example.edu");
    vi.stubEnv("SCHOOL_EMAIL_FORWARDERS", "student@example.edu");
    vi.stubEnv("SCHOOL_BLACKBOARD_HOSTS", "learn.example.edu");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("RESEND_API_KEY", apiKey);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockReset().mockResolvedValue({
      data: { status: "processed", eventId: "resend-event-1", itemId: "item-1", taskId: "task-1" },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("1. processes a valid Resend inbound webhook for a Blackboard assignment", async () => {
    const response = await POST(createSignedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "processed" });
    expect(rpc).toHaveBeenCalledWith(
      "ingest_school_email",
      expect.objectContaining({
        p_user_id: owner,
        p_event: expect.objectContaining({
          provider: "resend",
          sourceMessageId: "resend-delivery-1",
          itemType: "assignment",
          title: "Assignment 1",
          dueDate: "2026-09-15",
        }),
      })
    );
    const event = rpc.mock.calls[0][1].p_event;
    expect(event).not.toHaveProperty("text");
    expect(event).not.toHaveProperty("html");
    expect(JSON.stringify(event)).not.toContain(apiKey);
    expect(JSON.stringify(event)).not.toContain(webhookSecret);
  });

  it("2. rejects invalid webhook signature with 401 unauthorized", async () => {
    const request = createSignedRequest(resendWebhookPayload(), {
      headers: { "svix-signature": "v1,bad_signature" },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("3. ignores unsupported webhook event types (e.g. email.sent)", async () => {
    const payload = resendWebhookPayload({}, { type: "email.sent" });
    const response = await POST(createSignedRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "ignored" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("4. rejects malformed webhook payloads with 422", async () => {
    // Missing data
    const noData = createSignedRequest({ type: "email.received" });
    expect((await POST(noData)).status).toBe(422);

    // Invalid JSON
    const badJson = createSignedRequest("not valid json {");
    expect((await POST(badJson)).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("5. retrieves full received email via Resend receiving API when body is not in webhook", async () => {
    const payloadWithoutBody = {
      type: "email.received",
      created_at: "2026-09-08T02:00:00.000Z",
      data: {
        email_id: "em_remote_123",
        created_at: "2026-09-08T02:00:00.000Z",
        from: "notifications@learn.example.edu",
        to: ["school@inbound.example.com"],
        subject: "New assignment: Assignment 1",
        message_id: "<orig-assignment-1@learn.example.edu>",
      },
    };

    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "email",
          id: "em_remote_123",
          from: "notifications@learn.example.edu",
          to: ["school@inbound.example.com"],
          created_at: "2026-09-08T02:00:00.000Z",
          subject: "New assignment: Assignment 1",
          text: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: September 15, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1",
          html: "",
          headers: {
            "x-spam-status": "No",
            "x-spam-tests": "DKIM_VALID_AU",
            "message-id": "<orig-assignment-1@learn.example.edu>",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const response = await POST(createSignedRequest(payloadWithoutBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "processed" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails/receiving/em_remote_123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      "ingest_school_email",
      expect.objectContaining({
        p_event: expect.objectContaining({
          sourceMessageId: "em_remote_123",
          title: "Assignment 1",
        }),
      })
    );
  });

  it("6. returns duplicate status for duplicate/replayed webhook", async () => {
    rpc.mockResolvedValueOnce({
      data: { status: "duplicate", eventId: "resend-event-1", itemId: "item-1", taskId: "task-1" },
      error: null,
    });
    const response = await POST(createSignedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "duplicate" });
  });

  it("7. deduplicates by original RFC Message-ID across deliveries", async () => {
    rpc.mockResolvedValueOnce({
      data: { status: "duplicate", eventId: "prev-event", itemId: "item-1", taskId: "task-1" },
      error: null,
    });
    const payload = resendWebhookPayload({
      email_id: "resend-second-delivery-999",
      message_id: "<stable-rfc-id@learn.example.edu>",
    });
    const response = await POST(createSignedRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "duplicate" });
  });

  it("8. parses and processes forwarded Blackboard email from configured forwarder", async () => {
    const forwardedText = `Please add this to my tasks.
From: Blackboard <notifications@learn.example.edu>
Sent: Tue, 8 Sep 2026 10:00:00 +0800
Subject: New assignment: Assignment 1

Course: CS101
Item Type: Assignment
Title: Assignment 1
Due Date: September 15, 2026 at 11:59 PM Asia/Manila
https://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1`;

    const payload = resendWebhookPayload({
      from: "student@example.edu",
      subject: "FW: New assignment: Assignment 1",
      text: forwardedText,
    });

    const response = await POST(createSignedRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "processed" });
    expect(rpc).toHaveBeenCalledWith(
      "ingest_school_email",
      expect.objectContaining({
        p_event: expect.objectContaining({
          title: "Assignment 1",
          itemType: "assignment",
        }),
      })
    );
  });

  it("9. ignores emails sent to wrong recipient address without calling RPC", async () => {
    const payload = resendWebhookPayload({ to: ["wrong-student@inbound.example.com"] });
    const response = await POST(createSignedRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "ignored" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("10. persists untrusted/invalid sender or missing authentication as ignored", async () => {
    // Missing DKIM authentication
    const unauthPayload = resendWebhookPayload({
      headers: { "x-spam-status": "Yes" },
    });
    const response = await POST(createSignedRequest(unauthPayload));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "ingest_school_email",
      expect.objectContaining({
        p_event: expect.objectContaining({
          status: "ignored",
          reason: "unauthenticated_delivery",
        }),
      })
    );
  });

  it("11. records malformed parser results safely", async () => {
    const malformedDatePayload = resendWebhookPayload({
      text: "Course: CS101\nTitle: Assignment 1\nDue Date: tomorrow-ish",
    });
    const response = await POST(createSignedRequest(malformedDatePayload));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "ingest_school_email",
      expect.objectContaining({
        p_event: expect.objectContaining({
          status: "malformed",
        }),
      })
    );
  });

  it("12. returns 500 retryable error on Resend API retrieval failure", async () => {
    const payloadWithoutBody = {
      type: "email.received",
      data: {
        email_id: "em_fail_api",
        from: "notifications@learn.example.edu",
        to: ["school@inbound.example.com"],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server Error", { status: 500 })
    );

    const response = await POST(createSignedRequest(payloadWithoutBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, code: "ingestion_failed" });
    expect(console.error).toHaveBeenCalledWith("[school-email]", { code: "ingestion_failed" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("13. returns 503 not_configured when required environment variables are absent", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const response = await POST(createSignedRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "not_configured" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("14. enforces payload limits (413) and content-type (415)", async () => {
    const nonJson = createSignedRequest(resendWebhookPayload(), {
      headers: { "content-type": "text/plain" },
    });
    expect((await POST(nonJson)).status).toBe(415);

    const hugeBody = "x".repeat(600_000);
    const oversized = createSignedRequest(hugeBody, {
      headers: { "content-length": "600000" },
    });
    expect((await POST(oversized)).status).toBe(413);
  });
});
