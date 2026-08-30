import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  encryptWebPushPayload,
  generateVapidAuthHeader,
  importVapidPrivateKey,
  sendWebPushNotification,
  type WebPushSubscription,
} from "./web-push-client";

describe("Web Push Client & RFC 8291 / RFC 8292 Encryption (Phase 4D)", () => {
  // Generate a valid P-256 test VAPID keypair
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const testVapidPublicKey = ecdh.getPublicKey("base64url");
  const testVapidPrivateKey = ecdh.getPrivateKey("base64url");
  const testSubject = "mailto:test@redline.internal";
  const testEndpoint = "https://fcm.googleapis.com/fcm/send/sample-client-token";

  // Generate a valid client receiver keypair (P-256)
  const clientEcdh = crypto.createECDH("prime256v1");
  clientEcdh.generateKeys();
  const clientP256dh = clientEcdh.getPublicKey("base64url");
  const clientAuth = crypto.randomBytes(16).toString("base64url");

  const sampleSubscription: WebPushSubscription = {
    id: "sub-1",
    endpoint: testEndpoint,
    p256dh: clientP256dh,
    auth: clientAuth,
  };

  describe("VAPID Authorization Header Generation (RFC 8292)", () => {
    it("generates a valid signed VAPID header with ES256 JWT", () => {
      const authHeader = generateVapidAuthHeader({
        endpoint: testEndpoint,
        vapidPublicKey: testVapidPublicKey,
        vapidPrivateKey: testVapidPrivateKey,
        subject: testSubject,
        nowSeconds: 1700000000,
      });

      expect(authHeader).toMatch(/^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/);

      const match = authHeader.match(/^vapid t=([^,]+), k=(.+)$/);
      expect(match).not.toBeNull();
      const [, jwt, pubKey] = match!;

      expect(pubKey).toBe(testVapidPublicKey);

      const [headerB64, payloadB64, signatureB64] = jwt.split(".");
      const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

      expect(header).toEqual({ typ: "JWT", alg: "ES256" });
      expect(payload.aud).toBe("https://fcm.googleapis.com");
      expect(payload.sub).toBe(testSubject);
      expect(payload.exp).toBe(1700000000 + 12 * 3600);

      // Verify the ES256 signature using the public key
      const unsignedData = `${headerB64}.${payloadB64}`;
      const rawPub = Buffer.from(testVapidPublicKey, "base64url");
      const verifierKey = crypto.createPublicKey({
        key: {
          kty: "EC",
          crv: "P-256",
          x: rawPub.subarray(1, 33).toString("base64url"),
          y: rawPub.subarray(33, 65).toString("base64url"),
        },
        format: "jwk",
      });

      const signatureBuf = Buffer.from(signatureB64, "base64url");
      const isValid = crypto.verify(
        null,
        Buffer.from(unsignedData, "utf8"),
        {
          key: verifierKey,
          dsaEncoding: "ieee-p1363",
        },
        signatureBuf,
      );

      expect(isValid).toBe(true);
    });

    it("imports raw base64url private key into KeyObject", () => {
      const keyObj = importVapidPrivateKey(testVapidPrivateKey, testVapidPublicKey);
      expect(keyObj.type).toBe("private");
      expect(keyObj.asymmetricKeyType).toBe("ec");
    });
  });

  describe("Web Push Message Encryption (RFC 8291 aes128gcm)", () => {
    it("encrypts payload into a valid RFC 8188 / RFC 8291 binary structure", () => {
      const plaintext = JSON.stringify({
        title: "Upcoming Class",
        body: "Algorithms HW due in 30m",
        url: "/tasks",
      });

      const encrypted = encryptWebPushPayload({
        p256dh: clientP256dh,
        auth: clientAuth,
        payload: plaintext,
      });

      // Binary header layout:
      // 0..15: salt (16 bytes)
      // 16..19: record size (4 bytes uint32BE)
      // 20: id len (1 byte, 65)
      // 21..85: server public key (65 bytes)
      // 86..end: ciphertext + tag
      expect(encrypted.length).toBeGreaterThan(86 + 16);

      const salt = encrypted.subarray(0, 16);
      const recordSize = encrypted.readUInt32BE(16);
      const idLen = encrypted.readUInt8(20);
      const senderPubKey = encrypted.subarray(21, 86);

      expect(salt.length).toBe(16);
      expect(recordSize).toBe(4096);
      expect(idLen).toBe(65);
      expect(senderPubKey[0]).toBe(0x04); // Uncompressed EC point

      // Verify decryptability by client receiver
      const receiverSharedSecret = clientEcdh.computeSecret(senderPubKey);
      const receiverAuth = Buffer.from(clientAuth, "base64url");
      const receiverPubKey = Buffer.from(clientP256dh, "base64url");

      const ikmInfo = Buffer.concat([
        Buffer.from("WebPush: info\0", "utf8"),
        receiverPubKey,
        senderPubKey,
      ]);
      const ikm = Buffer.from(
        crypto.hkdfSync("sha256", receiverSharedSecret, receiverAuth, ikmInfo, 32),
      );

      const keyInfo = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
      const nonceInfo = Buffer.from("Content-Encoding: nonce\0", "utf8");
      const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, keyInfo, 16));
      const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, nonceInfo, 12));

      const ciphertextWithTag = encrypted.subarray(86);
      const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
      const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

      const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(tag);
      const decryptedPadded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      // Remove RFC 8291 0x02 delimiter
      expect(decryptedPadded[decryptedPadded.length - 1]).toBe(0x02);
      const decrypted = decryptedPadded.subarray(0, decryptedPadded.length - 1).toString("utf8");

      expect(decrypted).toBe(plaintext);
    });

    it("fails fast when client public key or auth secret is malformed", () => {
      expect(() =>
        encryptWebPushPayload({
          p256dh: "short-key",
          auth: clientAuth,
          payload: "Hello",
        }),
      ).toThrow();

      expect(() =>
        encryptWebPushPayload({
          p256dh: clientP256dh,
          auth: "short-auth",
          payload: "Hello",
        }),
      ).toThrow();
    });
  });

  describe("Web Push Delivery Handling (sendWebPushNotification)", () => {
    it("returns ok: true on 201 Created from push service", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: () => Promise.resolve(""),
      } as unknown as Response);

      const result = await sendWebPushNotification({
        subscription: sampleSubscription,
        payload: {
          title: "Math Homework",
          body: "Due at 5 PM",
          url: "/tasks",
          dedupeKey: "task_due_soon:1:2026-08-30",
        },
        vapidKeys: {
          publicKey: testVapidPublicKey,
          privateKey: testVapidPrivateKey,
          subject: testSubject,
        },
        fetchImpl: mockFetch,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(result.permanentFailure).toBe(false);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(testEndpoint);
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Encoding"]).toBe("aes128gcm");
      expect(init.headers["TTL"]).toBe("86400");
      expect(init.headers["Topic"]).toBe("task_due_soon-1-2026-08-30");
      expect(init.headers["Authorization"]).toMatch(/^vapid t=/);
    });

    it("identifies 410 Gone / 404 Not Found as permanent subscription failure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
        text: () => Promise.resolve("Subscription no longer valid"),
      } as unknown as Response);

      const result = await sendWebPushNotification({
        subscription: sampleSubscription,
        payload: {
          title: "Math Homework",
          body: "Due today",
          url: "/tasks",
        },
        vapidKeys: {
          publicKey: testVapidPublicKey,
          privateKey: testVapidPrivateKey,
          subject: testSubject,
        },
        fetchImpl: mockFetch,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(410);
      expect(result.permanentFailure).toBe(true);
      expect(result.errorCode).toBe("subscription_unregistered");
    });

    it("identifies 503 / 500 / 429 as transient failure without marking permanent", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve("Service Unavailable"),
      } as unknown as Response);

      const result = await sendWebPushNotification({
        subscription: sampleSubscription,
        payload: {
          title: "Math Homework",
          body: "Due today",
          url: "/tasks",
        },
        vapidKeys: {
          publicKey: testVapidPublicKey,
          privateKey: testVapidPrivateKey,
          subject: testSubject,
        },
        fetchImpl: mockFetch,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(503);
      expect(result.permanentFailure).toBe(false);
      expect(result.errorCode).toBe("push_service_error_503");
    });

    it("returns vapid_keys_missing when keys are empty", async () => {
      const result = await sendWebPushNotification({
        subscription: sampleSubscription,
        payload: {
          title: "Test",
          body: "Test",
          url: "/",
        },
        vapidKeys: {
          publicKey: "",
          privateKey: "",
        },
      });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("vapid_keys_missing");
    });
  });
});
