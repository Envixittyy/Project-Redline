import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import webPush from "web-push";

vi.mock("server-only", () => ({}));

import {
  sendWebPushNotification,
  validateWebPushSubscription,
  type WebPushSubscription,
} from "./web-push-client";

const receiver = crypto.createECDH("prime256v1");
receiver.generateKeys();

const subscription: WebPushSubscription = {
  id: "sub-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/device-token",
  p256dh: receiver.getPublicKey("base64url"),
  auth: crypto.randomBytes(16).toString("base64url"),
};
const vapidKeys = {
  ...webPush.generateVAPIDKeys(),
  subject: "mailto:push@example.com",
};

describe("Web Push client hardening", () => {
  it.each([
    "http://localhost:8080/push",
    "https://127.0.0.1/push",
    "https://192.168.1.20/push",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@fcm.googleapis.com/push",
    "https://fcm.googleapis.com:8443/push",
    "https://fcm.googleapis.com/push#fragment",
    "https://attacker.example/push",
    "https://fcm.googleapis.com.attacker.example/push",
  ])("rejects an untrusted subscription endpoint: %s", (endpoint) => {
    expect(validateWebPushSubscription({ ...subscription, endpoint })).toBeTruthy();
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://api.push.apple.com/token",
    "https://wns2-sg2p.notify.windows.com/w/?token=value",
  ])("accepts a supported browser push service: %s", (endpoint) => {
    expect(validateWebPushSubscription({ ...subscription, endpoint })).toBeNull();
  });

  it("rejects oversized subscription fields before decoding them", () => {
    expect(
      validateWebPushSubscription({
        endpoint: `https://fcm.googleapis.com/${"x".repeat(2_100)}`,
        p256dh: "x".repeat(10_000),
        auth: "x".repeat(10_000),
      }),
    ).toBe("invalid_subscription_shape");
  });

  it("rejects malformed subscription keys before any network request", async () => {
    expect(
      validateWebPushSubscription({ ...subscription, p256dh: "not-a-key" }),
    ).toBe("invalid_p256dh");
    expect(
      validateWebPushSubscription({ ...subscription, auth: "not-an-auth-secret" }),
    ).toBe("invalid_auth_secret");

    const fetchImpl = vi.fn();
    const result = await sendWebPushNotification({
      subscription: { ...subscription, p256dh: "not-a-key" },
      payload: { title: "Test", body: "Body", url: "/" },
      vapidKeys,
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: false,
      permanentFailure: true,
      errorCode: "invalid_p256dh",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses maintained Web Push request generation with aes128gcm, VAPID, timeout, and no redirects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 201 }),
    );

    const result = await sendWebPushNotification({
      subscription,
      payload: {
        title: "Task due soon",
        body: "A concise reminder.",
        url: "/tasks?view=today",
        dedupeKey: "task_due_soon:task-1:revision",
      },
      vapidKeys,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      status: 201,
      permanentFailure: false,
      errorCode: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(subscription.endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: 86400,
      Urgency: "normal",
      Topic: "task_due_soon-task-1-revision",
    });
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^vapid t=/,
    );
    expect(Buffer.from(init.body as Uint8Array).includes(Buffer.from("A concise reminder."))).toBe(
      false,
    );
  });

  it.each([404, 410])("treats HTTP %s as a permanent subscription failure", async (status) => {
    const result = await sendWebPushNotification({
      subscription,
      payload: { title: "Test", body: "Body", url: "/" },
      vapidKeys,
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status })),
    });

    expect(result).toMatchObject({
      ok: false,
      status,
      permanentFailure: true,
      errorCode: "subscription_unregistered",
    });
  });

  it.each([429, 500, 503])("keeps HTTP %s transient", async (status) => {
    const result = await sendWebPushNotification({
      subscription,
      payload: { title: "Test", body: "Body", url: "/" },
      vapidKeys,
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status })),
    });

    expect(result).toMatchObject({
      ok: false,
      status,
      permanentFailure: false,
      errorCode: `push_service_error_${status}`,
    });
  });

  it("fails closed when VAPID configuration is incomplete", async () => {
    const result = await sendWebPushNotification({
      subscription,
      payload: { title: "Test", body: "Body", url: "/" },
      vapidKeys: { publicKey: "", privateKey: "", subject: "" },
    });

    expect(result.errorCode).toBe("vapid_configuration_missing");
  });
});
