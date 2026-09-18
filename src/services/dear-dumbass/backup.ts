import type { DearDumbassPost } from "./types";

export const BACKUP_APP_IDENTIFIER = "redline";
export const BACKUP_FORMAT_IDENTIFIER = "dear-dumbass-encrypted-backup";
export const ARCHIVE_FORMAT_IDENTIFIER = "dear-dumbass-archive";
export const CURRENT_BACKUP_VERSION = 1;

// New backups use OWASP's current PBKDF2-HMAC-SHA-256 work factor. Version 1
// backups previously emitted with 100,000 iterations remain readable.
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_SUPPORTED_PBKDF2_ITERATIONS = 100_000;
export const MAX_SUPPORTED_PBKDF2_ITERATIONS = 2_000_000;
export const SALT_BYTE_LENGTH = 16;
export const IV_BYTE_LENGTH = 12;
export const AES_KEY_LENGTH = 256;
export const TAG_LENGTH = 128;
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 48 * 1024 * 1024 - 1_024;
export const MAX_ARCHIVE_POSTS = 100_000;
export const MAX_POST_BODY_CHARACTERS = 1_000_000;
export const MAX_ARCHIVE_BODY_CHARACTERS = 32_000_000;
const MAX_ID_CHARACTERS = 128;
const MAX_PASSPHRASE_BYTES = 4_096;

export interface DearDumbassBackupKdf {
  algorithm: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string; // base64
}

export interface DearDumbassBackupCipher {
  algorithm: "AES-GCM";
  iv: string; // base64
  tagLength: number;
}

export interface DearDumbassBackupEnvelope {
  app: "redline";
  format: "dear-dumbass-encrypted-backup";
  version: 1;
  createdAt: string;
  kdf: DearDumbassBackupKdf;
  cipher: DearDumbassBackupCipher;
  ciphertext: string; // base64
}

export interface DearDumbassArchivePayload {
  format: "dear-dumbass-archive";
  version: 1;
  exportedAt: string;
  posts: DearDumbassPost[];
}

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  mode: RestoreMode;
  restoredCount: number;
  updatedCount: number;
  preservedCount: number;
  totalProcessed: number;
}

/** Convert a Uint8Array to standard Base64 string */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert a standard Base64 string to Uint8Array */
export function base64ToBytes(base64: string): Uint8Array {
  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  ) {
    throw new Error("Invalid base64 encoding.");
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function validatePassphrase(passphrase: string): Uint8Array {
  if (!passphrase) {
    throw new Error("A passphrase is required for the encrypted backup.");
  }

  const encoded = new TextEncoder().encode(passphrase);
  if (encoded.byteLength > MAX_PASSPHRASE_BYTES) {
    throw new Error("The backup passphrase is too long.");
  }
  return encoded;
}

function normalizeTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid backup: ${field} must be an ISO timestamp.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid backup: ${field} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeNullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : normalizeTimestamp(value, field);
}

function validateRecordId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_CHARACTERS ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(
      `Invalid backup: ${field} must be a bounded, non-empty ID.`,
    );
  }
  return value;
}

/**
 * Derive an AES-GCM 256-bit key from a user-supplied passphrase using PBKDF2 with SHA-256.
 */
async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  keyUsages: KeyUsage[],
): Promise<CryptoKey> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API is unavailable in the current environment.");
  }
  const encodedPassphrase = validatePassphrase(passphrase);
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encodedPassphrase as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    passphraseKey,
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
    },
    false,
    keyUsages,
  );
}

/**
 * Validate that an unknown object conforms to the DearDumbassBackupEnvelope structure.
 */
export function isBackupEnvelope(data: unknown): data is DearDumbassBackupEnvelope {
  if (!data || typeof data !== "object") return false;
  const env = data as Record<string, unknown>;
  const kdf = env.kdf as Record<string, unknown> | null;
  const cipher = env.cipher as Record<string, unknown> | null;
  return (
    env.app === BACKUP_APP_IDENTIFIER &&
    env.format === BACKUP_FORMAT_IDENTIFIER &&
    Number.isInteger(env.version) &&
    typeof env.createdAt === "string" &&
    typeof kdf === "object" &&
    kdf !== null &&
    kdf.algorithm === "PBKDF2" &&
    kdf.hash === "SHA-256" &&
    Number.isInteger(kdf.iterations) &&
    typeof kdf.salt === "string" &&
    typeof cipher === "object" &&
    cipher !== null &&
    cipher.algorithm === "AES-GCM" &&
    Number.isInteger(cipher.tagLength) &&
    typeof cipher.iv === "string" &&
    typeof env.ciphertext === "string"
  );
}

/**
 * Validate that a decrypted object conforms to the DearDumbassArchivePayload schema.
 * Rejects any malformed or corrupted records before writes are initiated.
 */
export function validateArchivePayload(data: unknown): DearDumbassArchivePayload {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid backup: archive payload is not an object.");
  }
  const payload = data as Record<string, unknown>;
  if (payload.format !== ARCHIVE_FORMAT_IDENTIFIER) {
    throw new Error("Invalid backup: unsupported archive payload format.");
  }
  if (payload.version !== CURRENT_BACKUP_VERSION) {
    throw new Error(
      `Invalid backup: unsupported archive payload version ${String(payload.version)}.`,
    );
  }
  if (!Array.isArray(payload.posts)) {
    throw new Error("Invalid backup: posts collection must be an array.");
  }
  if (payload.posts.length > MAX_ARCHIVE_POSTS) {
    throw new Error("Invalid backup: posts collection is too large.");
  }

  const validPosts: DearDumbassPost[] = [];
  const ids = new Set<string>();
  let totalBodyCharacters = 0;
  for (const item of payload.posts) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid backup: each post entry must be an object.");
    }
    const p = item as Record<string, unknown>;
    const id = validateRecordId(p.id, "post id");
    if (ids.has(id)) {
      throw new Error("Invalid backup: post IDs must be unique.");
    }
    ids.add(id);

    if (
      typeof p.body !== "string" ||
      p.body.length > MAX_POST_BODY_CHARACTERS
    ) {
      throw new Error("Invalid backup: post body must be a string.");
    }
    totalBodyCharacters += p.body.length;
    if (totalBodyCharacters > MAX_ARCHIVE_BODY_CHARACTERS) {
      throw new Error("Invalid backup: archive content is too large.");
    }

    const createdAt = normalizeTimestamp(p.createdAt, "post createdAt");
    const updatedAt = normalizeNullableTimestamp(p.updatedAt, "post updatedAt");
    if (
      p.revision !== undefined &&
      (!Number.isSafeInteger(p.revision) || (p.revision as number) < 0)
    ) {
      throw new Error(
        "Invalid backup: post revision must be a non-negative integer.",
      );
    }
    const replyToId =
      p.replyToId === null ? null : validateRecordId(p.replyToId, "replyToId");
    if (replyToId === id) {
      throw new Error("Invalid backup: a post cannot reply to itself.");
    }
    const deletedAt =
      p.deletedAt === null || p.deletedAt === undefined
        ? null
        : normalizeTimestamp(p.deletedAt, "post deletedAt");

    const isDeleted = deletedAt !== null;
    if (!isDeleted && !p.body.trim()) {
      throw new Error("Invalid backup: active post body cannot be blank.");
    }
    validPosts.push({
      id,
      // Enforce tombstone privacy invariant: deleted records have scrubbed body
      body: isDeleted ? "" : p.body,
      createdAt,
      updatedAt,
      revision: typeof p.revision === "number" ? p.revision : 0,
      replyToId,
      deletedAt,
    });
  }

  const postsById = new Map(validPosts.map((post) => [post.id, post]));
  for (const post of validPosts) {
    if (!post.replyToId) continue;
    const parent = postsById.get(post.replyToId);
    if (!parent) {
      throw new Error("Invalid backup: every reply must reference an archived root post.");
    }
    if (parent.replyToId) {
      throw new Error("Invalid backup: nested replies are not supported.");
    }
    if (parent.deletedAt && !post.deletedAt) {
      throw new Error(
        "Invalid backup: active replies cannot belong to a deleted root post.",
      );
    }
  }

  return {
    format: ARCHIVE_FORMAT_IDENTIFIER,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: normalizeTimestamp(payload.exportedAt, "exportedAt"),
    posts: validPosts,
  };
}

/**
 * Encrypt posts into a versioned Dear Dumbass backup envelope using Web Crypto.
 */
export async function createEncryptedBackup(
  posts: DearDumbassPost[],
  passphrase: string,
): Promise<DearDumbassBackupEnvelope> {
  validatePassphrase(passphrase);

  const payload = validateArchivePayload({
    format: ARCHIVE_FORMAT_IDENTIFIER,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    posts: posts.map((post) => ({
      id: post.id,
      body: post.deletedAt ? "" : post.body,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      revision: post.revision ?? 0,
      replyToId: post.replyToId,
      deletedAt: post.deletedAt ?? null,
    })),
  });

  const plaintextJson = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintextJson);
  if (plaintextBytes.byteLength > MAX_CIPHERTEXT_BYTES - TAG_LENGTH / 8) {
    throw new Error("Archive is too large to encrypt safely in this browser.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));

  const key = await deriveAesGcmKey(passphrase, salt, PBKDF2_ITERATIONS, [
    "encrypt",
  ]);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      tagLength: TAG_LENGTH,
    },
    key,
    plaintextBytes as unknown as BufferSource,
  );

  return {
    app: BACKUP_APP_IDENTIFIER,
    format: BACKUP_FORMAT_IDENTIFIER,
    version: CURRENT_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      algorithm: "AES-GCM",
      iv: bytesToBase64(iv),
      tagLength: TAG_LENGTH,
    },
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

/**
 * Decrypt and validate a Dear Dumbass backup envelope into memory.
 * Rejects incorrect passphrases or malformed backups cleanly without database writes.
 */
export async function decryptBackupArchive(
  rawEnvelope: unknown,
  passphrase: string,
): Promise<DearDumbassArchivePayload> {
  validatePassphrase(passphrase);

  if (!isBackupEnvelope(rawEnvelope)) {
    throw new Error("Malformed or invalid backup envelope.");
  }

  if (rawEnvelope.version !== CURRENT_BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup format version: ${String(rawEnvelope.version)}.`,
    );
  }

  if (
    rawEnvelope.kdf.algorithm !== "PBKDF2" ||
    rawEnvelope.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(rawEnvelope.kdf.iterations) ||
    rawEnvelope.kdf.iterations < MIN_SUPPORTED_PBKDF2_ITERATIONS ||
    rawEnvelope.kdf.iterations > MAX_SUPPORTED_PBKDF2_ITERATIONS
  ) {
    throw new Error("Unsupported or invalid key derivation parameters.");
  }

  if (
    rawEnvelope.cipher.algorithm !== "AES-GCM" ||
    rawEnvelope.cipher.tagLength !== TAG_LENGTH
  ) {
    throw new Error("Unsupported cipher algorithm.");
  }

  normalizeTimestamp(rawEnvelope.createdAt, "backup createdAt");

  if (rawEnvelope.ciphertext.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4) {
    throw new Error("Backup file is too large.");
  }

  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;

  try {
    salt = base64ToBytes(rawEnvelope.kdf.salt);
    iv = base64ToBytes(rawEnvelope.cipher.iv);
    ciphertext = base64ToBytes(rawEnvelope.ciphertext);
  } catch {
    throw new Error("Malformed or invalid base64 encoding in backup envelope.");
  }

  if (
    salt.byteLength !== SALT_BYTE_LENGTH ||
    iv.byteLength !== IV_BYTE_LENGTH ||
    ciphertext.byteLength < TAG_LENGTH / 8 ||
    ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error("Unsupported or invalid cryptographic parameters.");
  }

  const key = await deriveAesGcmKey(
    passphrase,
    salt,
    rawEnvelope.kdf.iterations,
    ["decrypt"],
  );

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        tagLength: TAG_LENGTH,
      },
      key,
      ciphertext as unknown as BufferSource,
    );
  } catch {
    // Web Crypto Subtle throws when tag authentication fails (wrong passphrase or tampered ciphertext)
    throw new Error("Incorrect passphrase or corrupted backup file.");
  }

  let plaintext: string;
  try {
    plaintext = new TextDecoder("utf-8", { fatal: true }).decode(decryptedBuffer);
  } catch {
    throw new Error("Corrupted archive payload: decrypted content is not UTF-8.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error(
      "Corrupted archive payload: decrypted content is not valid JSON.",
    );
  }

  return validateArchivePayload(parsed);
}
