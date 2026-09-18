import { describe, expect, it } from "vitest";

import {
  createMasterKeyAndEnvelope,
  decryptRecord,
  encryptRecord,
  unwrapMasterKey,
  PBKDF2_SYNC_ITERATIONS,
} from "./crypto";
import type { DearDumbassPost } from "../types";
import type { DearDumbassKeyEnvelope } from "./types";

describe("Dear Dumbass E2EE Crypto System", () => {
  const passphrase = "correct-battery-horse-stapler";
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const samplePost: DearDumbassPost = {
    id: "post-12345",
    body: "This is a strictly private thought for population 1.",
    createdAt: "2026-09-19T01:00:00.000Z",
    updatedAt: "2026-09-19T01:05:00.000Z",
    revision: 2,
    replyToId: null,
    deletedAt: null,
  };

  const sampleReply: DearDumbassPost = {
    id: "reply-67890",
    body: "This is a reply to my previous thought.",
    createdAt: "2026-09-19T01:10:00.000Z",
    updatedAt: null,
    revision: 0,
    replyToId: "post-12345",
    deletedAt: null,
  };

  const sampleTombstone: DearDumbassPost = {
    id: "tombstone-99999",
    body: "This text should be scrubbed before encryption!",
    createdAt: "2026-09-19T01:00:00.000Z",
    updatedAt: "2026-09-19T02:00:00.000Z",
    revision: 3,
    replyToId: null,
    deletedAt: "2026-09-19T02:00:00.000Z",
  };

  describe("Master Key Generation & Wrapping", () => {
    it("generates a valid key envelope and non-extractable master key", async () => {
      const { masterKey, envelope } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      expect(masterKey).toBeDefined();
      expect(masterKey.type).toBe("secret");
      expect(masterKey.algorithm.name).toBe("AES-GCM");
      expect(masterKey.extractable).toBe(false);

      expect(envelope.envelopeVersion).toBe(1);
      expect(envelope.keyVersion).toBe(1);
      expect(envelope.kdf.algorithm).toBe("PBKDF2");
      expect(envelope.kdf.hash).toBe("SHA-256");
      expect(envelope.kdf.iterations).toBe(PBKDF2_SYNC_ITERATIONS);
      expect(envelope.cipher.algorithm).toBe("AES-GCM");
      expect(envelope.cipher.tagLength).toBe(128);
      expect(typeof envelope.encryptedMasterKey).toBe("string");
      expect(envelope.encryptedMasterKey.length).toBeGreaterThan(0);
    });

    it("unwraps the master key with correct passphrase", async () => {
      const { envelope } = await createMasterKeyAndEnvelope(passphrase, ownerId);
      const unwrappedKey = await unwrapMasterKey(envelope, passphrase, ownerId);

      expect(unwrappedKey).toBeDefined();
      expect(unwrappedKey.type).toBe("secret");
      expect(unwrappedKey.extractable).toBe(false);

      // Verify that the unwrapped key can encrypt and decrypt records
      const encrypted = await encryptRecord(samplePost, unwrappedKey);
      const decrypted = await decryptRecord(
        {
          recordId: samplePost.id,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          keyVersion: encrypted.keyVersion,
          encryptionFormatVersion: encrypted.encryptionFormatVersion,
        },
        unwrappedKey,
      );

      expect(decrypted.id).toBe(samplePost.id);
      expect(decrypted.body).toBe(samplePost.body);
    });

    it("rejects incorrect passphrase with clean error and zero mutation", async () => {
      const { envelope } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      await expect(
        unwrapMasterKey(envelope, "completely-wrong-passphrase", ownerId),
      ).rejects.toThrow("Incorrect passphrase or corrupted key envelope.");
    });

    it("binds a wrapped master key to its authenticated owner", async () => {
      const { envelope } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      await expect(
        unwrapMasterKey(
          envelope,
          passphrase,
          "22222222-2222-4222-8222-222222222222",
        ),
      ).rejects.toThrow("Incorrect passphrase or corrupted key envelope.");
    });

    it("rejects tampered envelope parameters", async () => {
      const { envelope } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      // 1. Tampered ciphertext
      const tamperedCiphertext = {
        ...envelope,
        encryptedMasterKey: envelope.encryptedMasterKey.slice(0, -4) + "AAAA",
      };
      await expect(
        unwrapMasterKey(tamperedCiphertext, passphrase, ownerId),
      ).rejects.toThrow("Incorrect passphrase or corrupted key envelope.");

      // 2. Unsupported iterations (< 100,000)
      const lowIterations = {
        ...envelope,
        kdf: { ...envelope.kdf, iterations: 50_000 },
      };
      await expect(
        unwrapMasterKey(lowIterations, passphrase, ownerId),
      ).rejects.toThrow("Unsupported or invalid KDF parameters");

      // 3. Unsupported algorithm
      const badAlgorithm = {
        ...envelope,
        kdf: { ...envelope.kdf, algorithm: "MD5" as unknown as DearDumbassKeyEnvelope["kdf"]["algorithm"] },
      };
      await expect(
        unwrapMasterKey(badAlgorithm, passphrase, ownerId),
      ).rejects.toThrow("Unsupported or invalid KDF parameters");

      // 4. Corrupted salt base64
      const badSalt = {
        ...envelope,
        kdf: { ...envelope.kdf, salt: "invalid-base64!" },
      };
      await expect(
        unwrapMasterKey(badSalt, passphrase, ownerId),
      ).rejects.toThrow();

      const oversizedSalt = {
        ...envelope,
        kdf: { ...envelope.kdf, salt: "A".repeat(1_000_000) },
      };
      await expect(
        unwrapMasterKey(oversizedSalt, passphrase, ownerId),
      ).rejects.toThrow("Invalid salt length");
    });
  });

  describe("Record Encryption & Decryption", () => {
    it("encrypts and decrypts active post and reply accurately", async () => {
      const { masterKey } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      // 1. Root post
      const encPost = await encryptRecord(samplePost, masterKey);
      const decPost = await decryptRecord(
        {
          recordId: samplePost.id,
          ciphertext: encPost.ciphertext,
          iv: encPost.iv,
          keyVersion: encPost.keyVersion,
          encryptionFormatVersion: encPost.encryptionFormatVersion,
        },
        masterKey,
      );
      expect(decPost).toEqual(samplePost);

      // 2. Reply
      const encReply = await encryptRecord(sampleReply, masterKey);
      const decReply = await decryptRecord(
        {
          recordId: sampleReply.id,
          ciphertext: encReply.ciphertext,
          iv: encReply.iv,
          keyVersion: encReply.keyVersion,
          encryptionFormatVersion: encReply.encryptionFormatVersion,
        },
        masterKey,
      );
      expect(decReply).toEqual(sampleReply);
    });

    it("scrubs body of tombstoned records before encryption (privacy invariant)", async () => {
      const { masterKey } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      const encrypted = await encryptRecord(sampleTombstone, masterKey);
      const decrypted = await decryptRecord(
        {
          recordId: sampleTombstone.id,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          keyVersion: encrypted.keyVersion,
          encryptionFormatVersion: encrypted.encryptionFormatVersion,
        },
        masterKey,
      );

      // The body MUST be empty string in the decrypted tombstone
      expect(decrypted.body).toBe("");
      expect(decrypted.deletedAt).toBe(sampleTombstone.deletedAt);
      expect(decrypted.id).toBe(sampleTombstone.id);
    });

    it("generates a new unique IV for every encryption call", async () => {
      const { masterKey } = await createMasterKeyAndEnvelope(passphrase, ownerId);

      const enc1 = await encryptRecord(samplePost, masterKey);
      const enc2 = await encryptRecord(samplePost, masterKey);

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    });

    it("rejects tampered ciphertext, tampered IV, or mismatched AAD", async () => {
      const { masterKey } = await createMasterKeyAndEnvelope(passphrase, ownerId);
      const encrypted = await encryptRecord(samplePost, masterKey);

      // 1. Tampered ciphertext
      const tamperedCipher =
        encrypted.ciphertext.slice(0, -4) + "ZZZZ";
      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: tamperedCipher,
            iv: encrypted.iv,
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: encrypted.encryptionFormatVersion,
          },
          masterKey,
        ),
      ).rejects.toThrow("Decryption failed");

      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: 0,
          },
          masterKey,
        ),
      ).rejects.toThrow("Unsupported encrypted record format version");

      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: undefined as unknown as number,
          },
          masterKey,
        ),
      ).rejects.toThrow("Unsupported encrypted record format version");

      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: encrypted.ciphertext,
            iv: "A".repeat(1_000_000),
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: encrypted.encryptionFormatVersion,
          },
          masterKey,
        ),
      ).rejects.toThrow("Invalid IV length");

      // 2. Tampered IV
      const tamperedIv =
        encrypted.iv.slice(0, -4) + "AAAA";
      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: encrypted.ciphertext,
            iv: tamperedIv,
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: encrypted.encryptionFormatVersion,
          },
          masterKey,
        ),
      ).rejects.toThrow("Decryption failed");

      // 3. Mismatched record ID (AAD binding violation)
      await expect(
        decryptRecord(
          {
            recordId: "different-record-id",
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: encrypted.encryptionFormatVersion,
          },
          masterKey,
        ),
      ).rejects.toThrow("Decryption failed");

      // 4. Mismatched key version (AAD binding violation)
      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: 99,
            encryptionFormatVersion: encrypted.encryptionFormatVersion,
          },
          masterKey,
        ),
      ).rejects.toThrow("Unsupported encrypted record key version");
    });

    it("fails decryption when called with a different master key", async () => {
      const { masterKey: key1 } = await createMasterKeyAndEnvelope(passphrase, ownerId);
      const { masterKey: key2 } = await createMasterKeyAndEnvelope(
        "different-passphrase",
        ownerId,
      );

      const encrypted = await encryptRecord(samplePost, key1);

      await expect(
        decryptRecord(
          {
            recordId: samplePost.id,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion: encrypted.keyVersion,
            encryptionFormatVersion: encrypted.encryptionFormatVersion,
          },
          key2,
        ),
      ).rejects.toThrow("Decryption failed");
    });
  });
});
