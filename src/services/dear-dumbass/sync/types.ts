import type { DearDumbassPost } from "../types";

export const KEY_ENVELOPE_FORMAT_VERSION = 1;
export const CURRENT_KEY_VERSION = 1;
export const RECORD_ENCRYPTION_FORMAT_VERSION = 1;

export interface DearDumbassKeyEnvelope {
  envelopeVersion: number;
  keyVersion: number;
  kdf: {
    algorithm: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string; // base64
  };
  cipher: {
    algorithm: "AES-GCM";
    iv: string; // base64
    tagLength: number; // 128
  };
  encryptedMasterKey: string; // base64
  createdAt: string;
  updatedAt: string;
}

export interface DearDumbassEncryptedRecord {
  id?: string;
  ownerId?: string;
  recordId: string;
  keyVersion: number;
  syncVersion: number;
  ciphertext: string; // base64
  iv: string; // base64
  encryptionFormatVersion: number;
  serverChangeSequence?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DearDumbassRecordPayload {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  revision: number;
  replyToId: string | null;
  deletedAt: string | null;
}

export interface DearDumbassOutboxItem {
  id: string; // unique operation UUID
  recordId: string; // references post id in dear_dumbass_posts
  action: "upsert";
  queuedAt: string;
  attempts: number;
  lastError?: string | null;
}

export interface DearDumbassSyncConflict {
  id: string; // recordId
  localPost: DearDumbassPost;
  remotePost: DearDumbassPost;
  detectedAt: string;
}

export type DearDumbassSyncStatus =
  | "local_only"
  | "saved_locally"
  | "waiting_to_sync"
  | "syncing"
  | "synced"
  | "conflict"
  | "locked"
  | "error";

export interface DearDumbassSyncState {
  status: DearDumbassSyncStatus;
  lastSyncedAt: string | null;
  pendingCount: number;
  conflictCount: number;
  errorMessage: string | null;
  isUnlocked: boolean;
}
