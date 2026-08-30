import "server-only";

import webPush from "web-push";

export type WebPushSubscription = {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  subject?: string;
};

export type WebPushSendResult = {
  ok: boolean;
  status: number;
  permanentFailure: boolean;
  errorCode: string | null;
};

const PUSH_REQUEST_TIMEOUT_MS = 10_000;

function isAllowedPushServiceHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "fcm.googleapis.com" ||
    normalized === "updates.push.services.mozilla.com" ||
    normalized.endsWith(".push.services.mozilla.com") ||
    normalized === "web.push.apple.com" ||
    normalized.endsWith(".push.apple.com") ||
    normalized === "notify.windows.com" ||
    normalized.endsWith(".notify.windows.com")
  );
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

/**
 * Accept only browser-issued endpoints for the push services Forward supports.
 * This prevents an authenticated browser from turning notification delivery
 * into a general-purpose server-side request primitive.
 */
export function validateWebPushSubscription(
  subscription: WebPushSubscription,
): string | null {
  if (
    !subscription.endpoint ||
    subscription.endpoint.length > 2_048 ||
    !subscription.p256dh ||
    subscription.p256dh.length > 128 ||
    !subscription.auth ||
    subscription.auth.length > 64
  ) {
    return "invalid_subscription_shape";
  }

  let endpoint: URL;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    return "invalid_endpoint";
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    (endpoint.port && endpoint.port !== "443") ||
    !isAllowedPushServiceHostname(endpoint.hostname)
  ) {
    return "untrusted_push_service";
  }

  const receiverKey = decodeBase64Url(subscription.p256dh);
  if (!receiverKey || receiverKey.length !== 65 || receiverKey[0] !== 0x04) {
    return "invalid_p256dh";
  }

  const authSecret = decodeBase64Url(subscription.auth);
  if (!authSecret || authSecret.length !== 16) {
    return "invalid_auth_secret";
  }

  return null;
}

function cleanTopic(value: string | undefined): string | undefined {
  const topic = value?.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  return topic || undefined;
}

/**
 * Deliver a Web Push notification using the maintained `web-push` package for
 * RFC 8291 payload encryption and RFC 8292 VAPID request construction.
 */
export async function sendWebPushNotification(input: {
  subscription: WebPushSubscription;
  payload: {
    title: string;
    body: string;
    url: string;
    dedupeKey?: string;
  };
  vapidKeys?: VapidKeys;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
}): Promise<WebPushSendResult> {
  const { subscription, payload } = input;
  const subscriptionError = validateWebPushSubscription(subscription);
  if (subscriptionError) {
    return {
      ok: false,
      status: 0,
      permanentFailure: true,
      errorCode: subscriptionError,
    };
  }

  const publicKey =
    input.vapidKeys?.publicKey ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey =
    input.vapidKeys?.privateKey ?? process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = input.vapidKeys?.subject ?? process.env.VAPID_SUBJECT ?? "";

  if (!publicKey || !privateKey || !subject) {
    return {
      ok: false,
      status: 0,
      permanentFailure: false,
      errorCode: "vapid_configuration_missing",
    };
  }

  let requestDetails: ReturnType<typeof webPush.generateRequestDetails>;
  try {
    requestDetails = webPush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: input.ttlSeconds ?? 86_400,
        urgency: "normal",
        topic: cleanTopic(payload.dedupeKey),
        contentEncoding: "aes128gcm",
        vapidDetails: {
          subject,
          publicKey,
          privateKey,
        },
      },
    );
  } catch {
    return {
      ok: false,
      status: 0,
      permanentFailure: true,
      errorCode: "invalid_push_configuration",
    };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const response = await fetchFn(requestDetails.endpoint, {
      method: "POST",
      headers: requestDetails.headers,
      body: requestDetails.body
        ? new Uint8Array(requestDetails.body)
        : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(PUSH_REQUEST_TIMEOUT_MS),
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        permanentFailure: false,
        errorCode: null,
      };
    }

    if (response.status === 404 || response.status === 410) {
      return {
        ok: false,
        status: response.status,
        permanentFailure: true,
        errorCode: "subscription_unregistered",
      };
    }

    return {
      ok: false,
      status: response.status,
      permanentFailure: false,
      errorCode: `push_service_error_${response.status}`,
    };
  } catch (error) {
    const errorCode =
      error instanceof Error && error.name === "TimeoutError"
        ? "push_request_timeout"
        : "push_network_error";
    return {
      ok: false,
      status: 0,
      permanentFailure: false,
      errorCode,
    };
  }
}
