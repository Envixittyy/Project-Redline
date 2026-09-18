import type { DearDumbassPost } from "../types";
import {
  base64ToBytes,
  bytesToBase64,
  MAX_POST_BODY_CHARACTERS,
} from "../backup";
import {
  CURRENT_KEY_VERSION,
  KEY_ENVELOPE_FORMAT_VERSION,
  RECORD_ENCRYPTION_FORMAT_VERSION,
  type DearDumbassKeyEnvelope,
  type DearDumbassRecordPayload,
} from "./types";

export const PBKDF2_SYNC_ITERATIONS = 600_000;
export const MIN_SUPPORTED_PBKDF2_ITERATIONS = 100_000;
export const MAX_SUPPORTED_PBKDF2_ITERATIONS = 2_000_000;
export const SALT_BYTE_LENGTH = 16;
export const IV_BYTE_LENGTH = 12; // 96 bits for AES-GCM
export const AES_KEY_LENGTH = 256;
export const TAG_LENGTH = 128;
export const MAX_PASSPHRASE_BYTES = 4_096;
const MAX_ID_CHARACTERS = 128;

function validatePassphrase(passphrase: string): Uint8Array {
  if (!passphrase || typeof passphrase !== "string") {
    throw new Error("A passphrase is required.");
  }
  const encoded = new TextEncoder().encode(passphrase);
  if (encoded.byteLength === 0) {
    throw new Error("Passphrase cannot be empty.");
  }
  if (encoded.byteLength > MAX_PASSPHRASE_BYTES) {
    throw new Error("The sync passphrase is too long.");
  }
  return encoded;
}

function getWebCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API is unavailable in the current environment.");
  }
  return crypto;
}

/**
 * Derive an AES-GCM 256-bit Key-Encryption Key (KEK) from a passphrase and salt using PBKDF2.
 */
async function deriveKek(
  passphraseBytes: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyUsages: KeyUsage[],
): Promise<CryptoKey> {
  const c = getWebCrypto();
  const baseKey = await c.subtle.importKey(
    "raw",
    passphraseBytes as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return c.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
    },
    false,
    keyUsages,
  );
}

/**
 * Generates a random 256-bit Journal Master Key and wraps it into a DearDumbassKeyEnvelope.
 * Returns the non-extractable CryptoKey for local use and the encrypted envelope for cloud storage.
 */
export async function createMasterKeyAndEnvelope(
  passphrase: string,
): Promise<{ masterKey: CryptoKey; envelope: DearDumbassKeyEnvelope }> {
  const c = getWebCrypto();
  const passphraseBytes = validatePassphrase(passphrase);

  // Generate 256 bits of cryptographically secure random bytes for the master key
  const masterKeyBytes = c.getRandomValues(new Uint8Array(AES_KEY_LENGTH / 8));
  const salt = c.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const wrapIv = c.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));

  const kek = await deriveKek(passphraseBytes, salt, PBKDF2_SYNC_ITERATIONS, [
    "encrypt",
  ]);

  const encryptedBuffer = await c.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: wrapIv as unknown as BufferSource,
      tagLength: TAG_LENGTH,
    },
    kek,
    masterKeyBytes as unknown as BufferSource,
  );

  // Import the master key as NON-EXTRACTABLE for local use
  const masterKey = await c.subtle.importKey(
    "raw",
    masterKeyBytes as unknown as BufferSource,
    { name: "AES-GCM" },
    false, // Non-extractable
    ["encrypt", "decrypt"],
  );

  // Securely wipe raw master key bytes from memory buffer
  masterKeyBytes.fill(0);

  const now = new Date().toISOString();
  const envelope: DearDumbassKeyEnvelope = {
    envelopeVersion: KEY_ENVELOPE_FORMAT_VERSION,
    keyVersion: CURRENT_KEY_VERSION,
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_SYNC_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      algorithm: "AES-GCM",
      iv: bytesToBase64(wrapIv),
      tagLength: TAG_LENGTH,
    },
    encryptedMasterKey: bytesToBase64(new Uint8Array(encryptedBuffer)),
    createdAt: now,
    updatedAt: now,
  };

  return { masterKey, envelope };
}

/**
 * Validates a key envelope and decrypts the Journal Master Key using the user's passphrase.
 * Returns a non-extractable Web Crypto CryptoKey.
 * Fails with an error if the passphrase is wrong or the envelope is corrupted.
 */
export async function unwrapMasterKey(
  envelope: DearDumbassKeyEnvelope,
  passphrase: string,
): Promise<CryptoKey> {
  const c = getWebCrypto();
  const passphraseBytes = validatePassphrase(passphrase);

  if (!envelope || typeof envelope !== "object") {
    throw new Error("Invalid key envelope: not an object.");
  }

  if (envelope.envelopeVersion !== KEY_ENVELOPE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported envelope version: ${String(envelope.envelopeVersion)}.`,
    );
  }

  if (
    !envelope.kdf ||
    envelope.kdf.algorithm !== "PBKDF2" ||
    envelope.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(envelope.kdf.iterations) ||
    envelope.kdf.iterations < MIN_SUPPORTED_PBKDF2_ITERATIONS ||
    envelope.kdf.iterations > MAX_SUPPORTED_PBKDF2_ITERATIONS
  ) {
    throw new Error("Unsupported or invalid KDF parameters in key envelope.");
  }

  if (
    !envelope.cipher ||
    envelope.cipher.algorithm !== "AES-GCM" ||
    envelope.cipher.tagLength !== TAG_LENGTH
  ) {
    throw new Error("Unsupported cipher parameters in key envelope.");
  }

  let salt: Uint8Array;
  let wrapIv: Uint8Array;
  let ciphertext: Uint8Array;

  try {
    salt = base64ToBytes(envelope.kdf.salt);
    wrapIv = base64ToBytes(envelope.cipher.iv);
    ciphertext = base64ToBytes(envelope.encryptedMasterKey);
  } catch {
    throw new Error("Malformed base64 encoding in key envelope.");
  }

  if (
    salt.byteLength !== SALT_BYTE_LENGTH ||
    wrapIv.byteLength !== IV_BYTE_LENGTH ||
    ciphertext.byteLength < TAG_LENGTH / 8
  ) {
    throw new Error("Invalid cryptographic parameter lengths in key envelope.");
  }

  const kek = await deriveKek(passphraseBytes, salt, envelope.kdf.iterations, [
    "decrypt",
  ]);

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await c.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: wrapIv as unknown as BufferSource,
        tagLength: TAG_LENGTH,
      },
      kek,
      ciphertext as unknown as BufferSource,
    );
  } catch {
    throw new Error("Incorrect passphrase or corrupted key envelope.");
  }

  if (decryptedBuffer.byteLength !== AES_KEY_LENGTH / 8) {
    throw new Error("Corrupted master key payload length.");
  }

  // Import as NON-EXTRACTABLE CryptoKey
  const masterKey = await c.subtle.importKey(
    "raw",
    decryptedBuffer,
    { name: "AES-GCM" },
    false, // Non-extractable
    ["encrypt", "decrypt"],
  );

  return masterKey;
}

/**
 * Constructs the deterministic Authenticated Additional Data (AAD) for a record.
 * Cryptographically binds ciphertext to record ID and key version.
 */
export function buildRecordAad(recordId: string, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(`v1:${recordId}:${keyVersion}`);
}

/**
 * Encrypt a single DearDumbassPost into ciphertext and IV using AES-256-GCM.
 * Uses a new cryptographically random 96-bit IV for every encryption.
 */
export async function encryptRecord(
  post: DearDumbassPost,
  masterKey: CryptoKey,
  keyVersion: number = CURRENT_KEY_VERSION,
): Promise<{
  ciphertext: string;
  iv: string;
  keyVersion: number;
  encryptionFormatVersion: number;
}> {
  const c = getWebCrypto();

  const isDeleted = Boolean(post.deletedAt);
  // Ensure deleted records have their body scrubbed to empty string before encryption
  const payload: DearDumbassRecordPayload = {
    id: post.id,
    body: isDeleted ? "" : post.body,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt ?? null,
    revision: post.revision ?? 0,
    replyToId: post.replyToId ?? null,
    deletedAt: post.deletedAt ?? null,
  };

  const plaintextJson = JSON.stringify(payload);
  const plaintextBytes = new TextEncoder().encode(plaintextJson);

  // Generate unique random 96-bit IV for every record encryption
  const iv = c.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const aad = buildRecordAad(post.id, keyVersion);

  const encryptedBuffer = await c.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      tagLength: TAG_LENGTH,
      additionalData: aad as unknown as BufferSource,
    },
    masterKey,
    plaintextBytes as unknown as BufferSource,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(iv),
    keyVersion,
    encryptionFormatVersion: RECORD_ENCRYPTION_FORMAT_VERSION,
  };
}

/**
 * Decrypt an encrypted record payload into a validated DearDumbassPost using the Journal Master Key.
 * Verifies Authenticated Additional Data (AAD) and validates domain invariants.
 */
export async function decryptRecord(
  record: {
    recordId: string;
    ciphertext: string;
    iv: string;
    keyVersion: number;
    encryptionFormatVersion?: number;
  },
  masterKey: CryptoKey,
): Promise<DearDumbassPost> {
  const c = getWebCrypto();

  if (!record || typeof record !== "object") {
    throw new Error("Invalid encrypted record: not an object.");
  }

  let ivBytes: Uint8Array;
  let ciphertextBytes: Uint8Array;
  try {
    ivBytes = base64ToBytes(record.iv);
    ciphertextBytes = base64ToBytes(record.ciphertext);
  } catch {
    throw new Error("Invalid base64 encoding in encrypted record.");
  }

  if (ivBytes.byteLength !== IV_BYTE_LENGTH) {
    throw new Error("Invalid IV length in encrypted record.");
  }
  if (ciphertextBytes.byteLength < TAG_LENGTH / 8) {
    throw new Error("Invalid ciphertext length in encrypted record.");
  }

  const aad = buildRecordAad(record.recordId, record.keyVersion);

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await c.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBytes as unknown as BufferSource,
        tagLength: TAG_LENGTH,
        additionalData: aad as unknown as BufferSource,
      },
      masterKey,
      ciphertextBytes as unknown as BufferSource,
    );
  } catch {
    throw new Error(
      "Decryption failed: tampered ciphertext, wrong key, or mismatched authentication data.",
    );
  }

  let jsonText: string;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(decryptedBuffer);
  } catch {
    throw new Error("Decrypted record payload is not valid UTF-8.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Decrypted record payload is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid record payload: not an object.");
  }

  const p = parsed as Record<string, unknown>;

  if (typeof p.id !== "string" || p.id !== record.recordId) {
    throw new Error("Decrypted record ID does not match envelope record ID.");
  }

  if (typeof p.body !== "string" || p.body.length > MAX_POST_BODY_CHARACTERS) {
    throw new Error("Invalid post body in decrypted record.");
  }

  if (typeof p.createdAt !== "string" || !Number.isFinite(Date.parse(p.createdAt))) {
    throw new Error("Invalid createdAt timestamp in decrypted record.");
  }

  const updatedAt =
    p.updatedAt === null || p.updatedAt === undefined
      ? null
      : String(p.updatedAt);
  if (updatedAt && !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Invalid updatedAt timestamp in decrypted record.");
  }

  const revision =
    typeof p.revision === "number" && Number.isSafeInteger(p.revision) && p.revision >= 0
      ? p.revision
      : 0;

  const replyToId =
    p.replyToId === null || p.replyToId === undefined
      ? null
      : String(p.replyToId);
  if (replyToId && (replyToId.length > MAX_ID_CHARACTERS || replyToId === p.id)) {
    throw new Error("Invalid replyToId in decrypted record.");
  }

  const deletedAt =
    p.deletedAt === null || p.deletedAt === undefined
      ? null
      : String(p.deletedAt);
  if (deletedAt && !Number.isFinite(Date.parse(deletedAt))) {
    throw new Error("Invalid deletedAt timestamp in decrypted record.");
  }

  const isDeleted = Boolean(deletedAt);
  if (!isDeleted && !p.body.trim()) {
    throw new Error("Active decrypted post cannot have an empty body.");
  }

  return {
    id: p.id,
    body: isDeleted ? "" : p.body,
    createdAt: new Date(Date.parse(p.createdAt)).toISOString(),
    updatedAt: updatedAt ? new Date(Date.parse(updatedAt)).toISOString() : null,
    revision,
    replyToId,
    deletedAt: deletedAt ? new Date(Date.parse(deletedAt)).toISOString() : null,
  };
}
