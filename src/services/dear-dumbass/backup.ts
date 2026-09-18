import type { DearDumbassPost } from "./types";

export const BACKUP_APP_IDENTIFIER = "redline";
export const BACKUP_FORMAT_IDENTIFIER = "dear-dumbass-encrypted-backup";
export const ARCHIVE_FORMAT_IDENTIFIER = "dear-dumbass-archive";
export const CURRENT_BACKUP_VERSION = 1;

export const PBKDF2_ITERATIONS = 100_000;
export const SALT_BYTE_LENGTH = 16;
export const IV_BYTE_LENGTH = 12;
export const AES_KEY_LENGTH = 256;
export const TAG_LENGTH = 128;

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
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
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
  return (
    env.app === BACKUP_APP_IDENTIFIER &&
    env.format === BACKUP_FORMAT_IDENTIFIER &&
    typeof env.version === "number" &&
    typeof env.createdAt === "string" &&
    typeof env.kdf === "object" &&
    env.kdf !== null &&
    typeof env.cipher === "object" &&
    env.cipher !== null &&
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

  const validPosts: DearDumbassPost[] = [];
  for (const item of payload.posts) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid backup: each post entry must be an object.");
    }
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id.trim()) {
      throw new Error("Invalid backup: post id must be a non-empty string.");
    }
    if (typeof p.body !== "string") {
      throw new Error("Invalid backup: post body must be a string.");
    }
    if (
      typeof p.createdAt !== "string" ||
      Number.isNaN(Date.parse(p.createdAt))
    ) {
      throw new Error(
        "Invalid backup: post createdAt must be a valid ISO date string.",
      );
    }
    if (
      p.updatedAt !== null &&
      (typeof p.updatedAt !== "string" || Number.isNaN(Date.parse(p.updatedAt)))
    ) {
      throw new Error(
        "Invalid backup: post updatedAt must be null or a valid ISO date string.",
      );
    }
    if (
      p.revision !== undefined &&
      (typeof p.revision !== "number" || p.revision < 0)
    ) {
      throw new Error(
        "Invalid backup: post revision must be a non-negative integer.",
      );
    }
    if (p.replyToId !== null && typeof p.replyToId !== "string") {
      throw new Error(
        "Invalid backup: post replyToId must be null or a string ID.",
      );
    }
    if (
      p.deletedAt !== null &&
      p.deletedAt !== undefined &&
      (typeof p.deletedAt !== "string" || Number.isNaN(Date.parse(p.deletedAt)))
    ) {
      throw new Error(
        "Invalid backup: post deletedAt must be null or a valid ISO date string.",
      );
    }

    const isDeleted = Boolean(p.deletedAt);
    validPosts.push({
      id: p.id,
      // Enforce tombstone privacy invariant: deleted records have scrubbed body
      body: isDeleted ? "" : p.body,
      createdAt: p.createdAt,
      updatedAt: (p.updatedAt as string) ?? null,
      revision: typeof p.revision === "number" ? p.revision : 0,
      replyToId: (p.replyToId as string) ?? null,
      deletedAt: (p.deletedAt as string) ?? null,
    });
  }

  return {
    format: ARCHIVE_FORMAT_IDENTIFIER,
    version: CURRENT_BACKUP_VERSION,
    exportedAt:
      typeof payload.exportedAt === "string"
        ? payload.exportedAt
        : new Date().toISOString(),
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
  const trimmed = passphrase.trim();
  if (!trimmed) {
    throw new Error("A passphrase is required to encrypt the backup.");
  }

  const payload: DearDumbassArchivePayload = {
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
  };

  const plaintextJson = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintextJson);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));

  const key = await deriveAesGcmKey(trimmed, salt, PBKDF2_ITERATIONS, [
    "encrypt",
  ]);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: TAG_LENGTH,
    },
    key,
    plaintextBytes,
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
  const trimmed = passphrase.trim();
  if (!trimmed) {
    throw new Error("A passphrase is required to decrypt the backup.");
  }

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
    typeof rawEnvelope.kdf.iterations !== "number" ||
    rawEnvelope.kdf.iterations < 1000
  ) {
    throw new Error("Unsupported or invalid key derivation parameters.");
  }

  if (rawEnvelope.cipher.algorithm !== "AES-GCM") {
    throw new Error("Unsupported cipher algorithm.");
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

  const key = await deriveAesGcmKey(
    trimmed,
    salt,
    rawEnvelope.kdf.iterations,
    ["decrypt"],
  );

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: rawEnvelope.cipher.tagLength ?? TAG_LENGTH,
      },
      key,
      ciphertext,
    );
  } catch {
    // Web Crypto Subtle throws when tag authentication fails (wrong passphrase or tampered ciphertext)
    throw new Error("Incorrect passphrase or corrupted backup file.");
  }

  const decoder = new TextDecoder();
  const plaintext = decoder.decode(decryptedBuffer);

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
