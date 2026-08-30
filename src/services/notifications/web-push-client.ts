import "server-only";

import crypto from "node:crypto";

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
  errorDetail?: string;
};

function base64UrlEncode(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}

/**
 * Creates a KeyObject from raw base64url or PEM VAPID private key.
 */
export function importVapidPrivateKey(
  privateKeyStr: string,
  publicKeyStr?: string,
): crypto.KeyObject {
  const trimmed = privateKeyStr.trim();
  if (trimmed.includes("-----BEGIN")) {
    return crypto.createPrivateKey(trimmed);
  }

  // Raw base64url private key (32 bytes)
  const rawPrivate = base64UrlDecode(trimmed);
  if (rawPrivate.length === 32) {
    let x: string | undefined;
    let y: string | undefined;

    if (publicKeyStr) {
      const rawPub = base64UrlDecode(publicKeyStr.trim());
      if (rawPub.length === 65 && rawPub[0] === 0x04) {
        x = base64UrlEncode(rawPub.subarray(1, 33));
        y = base64UrlEncode(rawPub.subarray(33, 65));
      }
    }

    // If public key coordinates were not parsed, compute from private key
    if (!x || !y) {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.setPrivateKey(rawPrivate);
      const pub = ecdh.getPublicKey();
      x = base64UrlEncode(pub.subarray(1, 33));
      y = base64UrlEncode(pub.subarray(33, 65));
    }

    return crypto.createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        d: base64UrlEncode(rawPrivate),
        x,
        y,
      },
      format: "jwk",
    });
  }

  // Fallback direct attempt
  return crypto.createPrivateKey(trimmed);
}

/**
 * Generates an RFC 8292 VAPID Authorization header string.
 */
export function generateVapidAuthHeader(input: {
  endpoint: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  subject?: string;
  nowSeconds?: number;
}): string {
  const { endpoint, vapidPublicKey, vapidPrivateKey, subject } = input;
  const endpointUrl = new URL(endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600; // 12 hours validity

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp,
    sub: subject || process.env.VAPID_SUBJECT || "mailto:admin@redline.internal",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKey = importVapidPrivateKey(vapidPrivateKey, vapidPublicKey);
  const signature = crypto.sign(null, Buffer.from(unsignedToken, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363", // Produces 64-byte raw (r, s) signature required by JWT
  });

  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;
  const cleanPublicKey = vapidPublicKey
    .trim()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `vapid t=${jwt}, k=${cleanPublicKey}`;
}

/**
 * Encrypts a message payload for Web Push using RFC 8291 (`aes128gcm`).
 */
export function encryptWebPushPayload(input: {
  p256dh: string;
  auth: string;
  payload: string | Record<string, unknown>;
  customSalt?: Buffer;
}): Buffer {
  const receiverPublicKey = base64UrlDecode(input.p256dh);
  if (receiverPublicKey.length !== 65 || receiverPublicKey[0] !== 0x04) {
    throw new Error("Invalid receiver public key: must be 65-byte uncompressed P-256 point");
  }

  const authSecret = base64UrlDecode(input.auth);
  if (authSecret.length !== 16) {
    throw new Error("Invalid receiver auth secret: must be 16 bytes");
  }

  // 1. Generate ephemeral sender key pair
  const senderEcdh = crypto.createECDH("prime256v1");
  senderEcdh.generateKeys();
  const senderPublicKey = senderEcdh.getPublicKey(); // 65 bytes

  // 2. Compute shared ECDH secret (32 bytes)
  const sharedSecret = senderEcdh.computeSecret(receiverPublicKey);

  // 3. Derive IKM via HKDF (RFC 8291 Section 3.2)
  // info = "WebPush: info\0" || receiver_public || sender_public
  const ikmInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    receiverPublicKey,
    senderPublicKey,
  ]);
  const ikm = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, authSecret, ikmInfo, 32),
  );

  // 4. Generate 16-byte random salt
  const salt = input.customSalt || crypto.randomBytes(16);

  // 5. Derive CEK (16 bytes) and Nonce (12 bytes) (RFC 8188 Section 2.1 & 2.2)
  const keyInfo = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0", "utf8");

  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, keyInfo, 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, nonceInfo, 12));

  // 6. Format plaintext with RFC 8291 delimiter byte 0x02
  const plaintextStr =
    typeof input.payload === "string"
      ? input.payload
      : JSON.stringify(input.payload);
  const plaintextBuf = Buffer.from(plaintextStr, "utf8");
  const paddedPlaintext = Buffer.concat([plaintextBuf, Buffer.from([0x02])]);

  // 7. Encrypt with AES-128-GCM
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(paddedPlaintext),
    cipher.final(),
    cipher.getAuthTag(), // 16 bytes tag
  ]);

  // 8. Build binary record header (RFC 8188):
  // [salt (16)][record size (4, uint32BE)][id length (1, 65)][sender public key (65)][ciphertext + tag]
  const recordSize = 4096;
  const headerBuf = Buffer.alloc(16 + 4 + 1 + 65);
  salt.copy(headerBuf, 0);
  headerBuf.writeUInt32BE(recordSize, 16);
  headerBuf.writeUInt8(65, 20);
  senderPublicKey.copy(headerBuf, 21);

  return Buffer.concat([headerBuf, ciphertext]);
}

/**
 * Delivers a Web Push notification to a push subscription.
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
  const fetchFn = input.fetchImpl || fetch;

  const publicKey =
    input.vapidKeys?.publicKey ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    "";
  const privateKey =
    input.vapidKeys?.privateKey ||
    process.env.VAPID_PRIVATE_KEY ||
    "";
  const subject =
    input.vapidKeys?.subject ||
    process.env.VAPID_SUBJECT ||
    "mailto:admin@redline.internal";

  if (!publicKey || !privateKey) {
    return {
      ok: false,
      status: 0,
      permanentFailure: false,
      errorCode: "vapid_keys_missing",
      errorDetail: "Server VAPID keys are not configured in environment.",
    };
  }

  if (
    !subscription.endpoint ||
    !subscription.endpoint.startsWith("https://") ||
    !subscription.p256dh ||
    !subscription.auth
  ) {
    return {
      ok: false,
      status: 0,
      permanentFailure: true,
      errorCode: "invalid_subscription_shape",
      errorDetail: "Subscription endpoint or keys are invalid.",
    };
  }

  let authHeader: string;
  let body: Buffer;

  try {
    authHeader = generateVapidAuthHeader({
      endpoint: subscription.endpoint,
      vapidPublicKey: publicKey,
      vapidPrivateKey: privateKey,
      subject,
    });
    body = encryptWebPushPayload({
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      payload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      permanentFailure: true,
      errorCode: "encryption_failed",
      errorDetail: message,
    };
  }

  const ttl = input.ttlSeconds ?? 86400; // 24 hours

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: `${ttl}`,
      Urgency: "normal",
      Authorization: authHeader,
    };

    if (payload.dedupeKey) {
      // Clean topic header for push collapse
      const cleanTopic = payload.dedupeKey
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .slice(0, 32);
      if (cleanTopic) {
        headers.Topic = cleanTopic;
      }
    }

    const response = await fetchFn(subscription.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
    });

    if (response.ok || [200, 201, 202, 204].includes(response.status)) {
      return {
        ok: true,
        status: response.status,
        permanentFailure: false,
        errorCode: null,
      };
    }

    // 404 Not Found or 410 Gone indicates expired or revoked subscription
    if (response.status === 404 || response.status === 410) {
      return {
        ok: false,
        status: response.status,
        permanentFailure: true,
        errorCode: "subscription_unregistered",
        errorDetail: `Push service returned ${response.status}: subscription is no longer valid.`,
      };
    }

    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      permanentFailure: false,
      errorCode: `push_service_error_${response.status}`,
      errorDetail: errorText.slice(0, 300),
    };
  } catch (networkErr) {
    const message =
      networkErr instanceof Error ? networkErr.message : String(networkErr);
    return {
      ok: false,
      status: 0,
      permanentFailure: false,
      errorCode: "network_error",
      errorDetail: message,
    };
  }
}
