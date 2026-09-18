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
export const SALT_BYTE_LENGTH = 16;
export const IV_BYTE_LENGTH = 12; // 96 bits for AES-GCM
export const AES_KEY_LENGTH = 256;
export const TAG_LENGTH = 128;
export const MAX_PASSPHRASE_BYTES = 4_096;
const MAX_ID_CHARACTERS = 128;
const WRAPPED_MASTER_KEY_BYTE_LENGTH = AES_KEY_LENGTH / 8 + TAG_LENGTH / 8;
const MAX_RECORD_CIPHERTEXT_BYTES = 4_100_000;

function assertOwnerId(ownerId: string): void {
  if (!ownerId || typeof ownerId !== "string" || ownerId.length > MAX_ID_CHARACTERS) {
    throw new Error("A valid journal owner is required.");
  }
}

function assertMasterKey(masterKey: CryptoKey): void {
  const algorithm = masterKey.algorithm as AesKeyAlgorithm;
  if (
    masterKey.type !== "secret" ||
    masterKey.extractable ||
    algorithm.name !== "AES-GCM" ||
    algorithm.length !== AES_KEY_LENGTH ||
    !masterKey.usages.includes("encrypt") ||
    !masterKey.usages.includes("decrypt")
  ) {
    throw new Error("Invalid journal master key.");
  }
}

function expectedBase64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

function assertBoundedBase64(value: unknown, exactBytes: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.length !== expectedBase64Length(exactBytes)
  ) {
    throw new Error(`Invalid ${label} length in key envelope.`);
  }
  return value;
}

function buildKeyEnvelopeAad(ownerId: string): Uint8Array {
  assertOwnerId(ownerId);
  return new TextEncoder().encode(
    `dear-dumbass-key-envelope|envelope=${KEY_ENVELOPE_FORMAT_VERSION}|owner=${ownerId.length}:${ownerId}|key=${CURRENT_KEY_VERSION}|kdf=PBKDF2-SHA-256-${PBKDF2_SYNC_ITERATIONS}|cipher=AES-256-GCM-${TAG_LENGTH}`,
  );
}

function validatePassphrase(passphrase: string): Uint8Array {
  if (!passphrase || typeof passphrase !== "string") {
    throw new Error("A passphrase is required.");
  }
  const encoded = new TextEncoder().encode(passphrase);
  if (encoded.byteLength === 0) {
    throw new Error("Passphrase cannot be empty.");
  }
  if (encoded.byteLength > MAX_PASSPHRASE_BYTES) {
    encoded.fill(0);
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
  ownerId: string,
): Promise<{ masterKey: CryptoKey; envelope: DearDumbassKeyEnvelope }> {
  const c = getWebCrypto();
  assertOwnerId(ownerId);
  const passphraseBytes = validatePassphrase(passphrase);
  let masterKeyBytes: Uint8Array | null = null;
  let salt: Uint8Array | null = null;
  let wrapIv: Uint8Array | null = null;

  try {
    // Generate 256 bits of cryptographically secure random bytes for the master key.
    masterKeyBytes = c.getRandomValues(new Uint8Array(AES_KEY_LENGTH / 8));
    salt = c.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
    wrapIv = c.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const kek = await deriveKek(passphraseBytes, salt, PBKDF2_SYNC_ITERATIONS, [
      "encrypt",
    ]);

    const encryptedBuffer = await c.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: wrapIv as unknown as BufferSource,
        tagLength: TAG_LENGTH,
        additionalData: buildKeyEnvelopeAad(ownerId) as unknown as BufferSource,
      },
      kek,
      masterKeyBytes as unknown as BufferSource,
    );

    // Import the master key as NON-EXTRACTABLE only after its wrapped copy exists.
    const masterKey = await c.subtle.importKey(
      "raw",
      masterKeyBytes as unknown as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );

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
  } finally {
    passphraseBytes.fill(0);
    masterKeyBytes?.fill(0);
    salt?.fill(0);
    wrapIv?.fill(0);
  }
}

/**
 * Validates a key envelope and decrypts the Journal Master Key using the user's passphrase.
 * Returns a non-extractable Web Crypto CryptoKey.
 * Fails with an error if the passphrase is wrong or the envelope is corrupted.
 */
export async function unwrapMasterKey(
  envelope: DearDumbassKeyEnvelope,
  passphrase: string,
  ownerId: string,
): Promise<CryptoKey> {
  const c = getWebCrypto();
  assertOwnerId(ownerId);

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
    envelope.kdf.iterations !== PBKDF2_SYNC_ITERATIONS
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

  assertBoundedBase64(envelope.kdf.salt, SALT_BYTE_LENGTH, "salt");
  assertBoundedBase64(envelope.cipher.iv, IV_BYTE_LENGTH, "wrap IV");
  assertBoundedBase64(
    envelope.encryptedMasterKey,
    WRAPPED_MASTER_KEY_BYTE_LENGTH,
    "wrapped master key",
  );

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
    ciphertext.byteLength !== WRAPPED_MASTER_KEY_BYTE_LENGTH
  ) {
    throw new Error("Invalid cryptographic parameter lengths in key envelope.");
  }

  if (envelope.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error("Unsupported key version in key envelope.");
  }

  const passphraseBytes = validatePassphrase(passphrase);
  let decryptedBytes: Uint8Array | null = null;
  try {
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
          additionalData: buildKeyEnvelopeAad(ownerId) as unknown as BufferSource,
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

    decryptedBytes = new Uint8Array(decryptedBuffer);
    return await c.subtle.importKey(
      "raw",
      decryptedBytes as unknown as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    passphraseBytes.fill(0);
    salt.fill(0);
    wrapIv.fill(0);
    ciphertext.fill(0);
    decryptedBytes?.fill(0);
  }
}

/**
 * Constructs the deterministic Authenticated Additional Data (AAD) for a record.
 * Cryptographically binds ciphertext to record ID and key version.
 */
export function buildRecordAad(
  recordId: string,
  keyVersion: number,
  encryptionFormatVersion: number,
): Uint8Array {
  if (
    typeof recordId !== "string" ||
    !recordId ||
    recordId.length > MAX_ID_CHARACTERS
  ) {
    throw new Error("Invalid encrypted record ID.");
  }
  if (keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error("Unsupported encrypted record key version.");
  }
  if (encryptionFormatVersion !== RECORD_ENCRYPTION_FORMAT_VERSION) {
    throw new Error("Unsupported encrypted record format version.");
  }
  return new TextEncoder().encode(
    `dear-dumbass-record|format=${encryptionFormatVersion}|id=${recordId.length}:${recordId}|key=${keyVersion}`,
  );
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
  assertMasterKey(masterKey);

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
  const aad = buildRecordAad(post.id, keyVersion, RECORD_ENCRYPTION_FORMAT_VERSION);

  try {
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
  } finally {
    plaintextBytes.fill(0);
  }
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
    encryptionFormatVersion: number;
  },
  masterKey: CryptoKey,
): Promise<DearDumbassPost> {
  const c = getWebCrypto();
  assertMasterKey(masterKey);

  if (!record || typeof record !== "object") {
    throw new Error("Invalid encrypted record: not an object.");
  }

  const encryptionFormatVersion = record.encryptionFormatVersion;
  const aad = buildRecordAad(
    record.recordId,
    record.keyVersion,
    encryptionFormatVersion,
  );
  if (
    typeof record.iv !== "string" ||
    record.iv.length !== expectedBase64Length(IV_BYTE_LENGTH)
  ) {
    throw new Error("Invalid IV length in encrypted record.");
  }
  if (
    typeof record.ciphertext !== "string" ||
    record.ciphertext.length > expectedBase64Length(MAX_RECORD_CIPHERTEXT_BYTES)
  ) {
    throw new Error("Invalid ciphertext length in encrypted record.");
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
  const decryptedBytes = new Uint8Array(decryptedBuffer);
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(decryptedBytes);
  } catch {
    throw new Error("Decrypted record payload is not valid UTF-8.");
  } finally {
    decryptedBytes.fill(0);
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

  const allowedFields = new Set([
    "id",
    "body",
    "createdAt",
    "updatedAt",
    "revision",
    "replyToId",
    "deletedAt",
  ]);
  if (Object.keys(p).some((key) => !allowedFields.has(key))) {
    throw new Error("Invalid unknown field in decrypted record payload.");
  }

  if (
    typeof p.id !== "string" ||
    p.id !== record.recordId ||
    p.id.length > MAX_ID_CHARACTERS
  ) {
    throw new Error("Decrypted record ID does not match envelope record ID.");
  }

  if (typeof p.body !== "string" || p.body.length > MAX_POST_BODY_CHARACTERS) {
    throw new Error("Invalid post body in decrypted record.");
  }

  if (
    typeof p.createdAt !== "string" ||
    !Number.isFinite(Date.parse(p.createdAt)) ||
    new Date(Date.parse(p.createdAt)).toISOString() !== p.createdAt
  ) {
    throw new Error("Invalid createdAt timestamp in decrypted record.");
  }

  if (p.updatedAt !== null && typeof p.updatedAt !== "string") {
    throw new Error("Invalid updatedAt timestamp in decrypted record.");
  }
  const updatedAt = p.updatedAt as string | null;
  if (
    updatedAt &&
    (!Number.isFinite(Date.parse(updatedAt)) ||
      new Date(Date.parse(updatedAt)).toISOString() !== updatedAt)
  ) {
    throw new Error("Invalid updatedAt timestamp in decrypted record.");
  }

  if (
    typeof p.revision !== "number" ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 0
  ) {
    throw new Error("Invalid revision in decrypted record.");
  }
  const revision = p.revision;

  if (p.replyToId !== null && typeof p.replyToId !== "string") {
    throw new Error("Invalid replyToId in decrypted record.");
  }
  const replyToId = p.replyToId as string | null;
  if (replyToId && (replyToId.length > MAX_ID_CHARACTERS || replyToId === p.id)) {
    throw new Error("Invalid replyToId in decrypted record.");
  }

  if (p.deletedAt !== null && typeof p.deletedAt !== "string") {
    throw new Error("Invalid deletedAt timestamp in decrypted record.");
  }
  const deletedAt = p.deletedAt as string | null;
  if (
    deletedAt &&
    (!Number.isFinite(Date.parse(deletedAt)) ||
      new Date(Date.parse(deletedAt)).toISOString() !== deletedAt)
  ) {
    throw new Error("Invalid deletedAt timestamp in decrypted record.");
  }

  const isDeleted = Boolean(deletedAt);
  if (isDeleted && p.body !== "") {
    throw new Error("Deleted record payload retained plaintext body.");
  }
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
