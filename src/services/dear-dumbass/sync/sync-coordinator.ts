import type { PrivateStore } from "@/services/private-store";

import type { DearDumbassPost } from "../types";
import {
  decryptRecord,
  encryptRecord,
} from "./crypto";
import type { DearDumbassCloudClient } from "./cloud-client";
import { SupabaseDearDumbassCloudClient } from "./cloud-client";
import { DearDumbassKeyManager } from "./key-manager";
import type {
  DearDumbassOutboxItem,
  DearDumbassSyncConflict,
  DearDumbassSyncState,
  DearDumbassSyncStatus,
} from "./types";

export const SYNC_OUTBOX_STORE = "dear_dumbass_sync_outbox";
export const SYNC_META_STORE = "dear_dumbass_sync_meta";
export const SYNC_CONFLICTS_STORE = "dear_dumbass_sync_conflicts";
export const POSTS_STORE = "dear_dumbass_posts";

export interface SyncCoordinatorOptions {
  store: PrivateStore;
  cloudClient?: DearDumbassCloudClient;
  keyManager?: DearDumbassKeyManager;
  onPostStoreMutated?: () => void;
}

export class DearDumbassSyncCoordinator {
  private store: PrivateStore;
  private cloudClient: DearDumbassCloudClient;
  private keyManager: DearDumbassKeyManager;
  private onPostStoreMutated?: () => void;

  private status: DearDumbassSyncStatus = "local_only";
  private lastSyncedAt: string | null = null;
  private errorMessage: string | null = null;
  private activeSyncPromise: Promise<void> | null = null;
  private queuedSyncRequested = false;
  private listeners = new Set<(state: DearDumbassSyncState) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SyncCoordinatorOptions) {
    this.store = options.store;
    this.cloudClient = options.cloudClient ?? new SupabaseDearDumbassCloudClient();
    this.keyManager = options.keyManager ?? new DearDumbassKeyManager(options.store);
    this.onPostStoreMutated = options.onPostStoreMutated;
  }

  getKeyManager(): DearDumbassKeyManager {
    return this.keyManager;
  }

  getCloudClient(): DearDumbassCloudClient {
    return this.cloudClient;
  }

  getState(): DearDumbassSyncState {
    return {
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      pendingCount: 0,
      conflictCount: 0,
      errorMessage: this.errorMessage,
      isUnlocked: this.keyManager.isUnlocked(),
    };
  }

  async getDetailedState(): Promise<DearDumbassSyncState> {
    let pendingCount = 0;
    let conflictCount = 0;
    try {
      const outbox = await this.store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
      pendingCount = outbox.length;
      const conflicts = await this.store.getAll<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE);
      conflictCount = conflicts.length;
    } catch {
      // Ignored
    }

    return {
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      pendingCount,
      conflictCount,
      errorMessage: this.errorMessage,
      isUnlocked: this.keyManager.isUnlocked(),
    };
  }

  async getConflicts(): Promise<DearDumbassSyncConflict[]> {
    return this.store.getAll<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE);
  }

  subscribe(listener: (state: DearDumbassSyncState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Safe subscriber error isolation
      }
    }
  }

  private setStatus(status: DearDumbassSyncStatus, error: string | null = null): void {
    this.status = status;
    this.errorMessage = error;
    this.notifyListeners();
  }

  /**
   * Initialize coordinator on app/feed load.
   * Checks local key, cloud key envelope, and triggers initial sync if enabled.
   */
  async initialize(): Promise<void> {
    try {
      const isUnlocked = await this.keyManager.loadLocalKey();

      // Check if sync is marked as enabled in metadata
      const syncConfig = await this.store.get<{ id: string; enabled: boolean }>(
        SYNC_META_STORE,
        "sync_config",
      );

      const userId = await this.cloudClient.getAuthUserId();

      if (!userId) {
        this.setStatus("local_only");
        return;
      }

      // Check if a cloud envelope exists for this user
      const envelope = await this.cloudClient.fetchKeyEnvelope();

      if (!envelope && !syncConfig?.enabled) {
        this.setStatus("local_only");
        return;
      }

      if (envelope && !isUnlocked) {
        this.setStatus("locked");
        return;
      }

      if (isUnlocked) {
        this.setStatus("synced");
        void this.triggerSync();
        this.startPeriodicSync();
      }
    } catch (err: unknown) {
      this.setStatus(
        "error",
        err instanceof Error ? err.message : "Initialization failed.",
      );
    }
  }

  private startPeriodicSync(): void {
    if (this.pollTimer || typeof window === "undefined") return;
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void this.triggerSync();
      }
    }, 60_000); // Heartbeat every 60s while tab is visible
  }

  stopPeriodicSync(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * First-device sync setup:
   * Generates master key, wraps envelope, uploads to cloud, and queues existing posts for upload.
   */
  async enableSync(passphrase: string): Promise<void> {
    this.setStatus("syncing");
    try {
      const userId = await this.cloudClient.getAuthUserId();
      if (!userId) {
        throw new Error("You must be signed in to Adulting.exe to enable encrypted sync.");
      }

      // 1. Generate master key and wrap with passphrase
      const { envelope } = await this.keyManager.setupNewMasterKey(passphrase);

      // 2. Upload key envelope to Supabase
      await this.cloudClient.uploadKeyEnvelope(envelope);

      // 3. Inspect existing local archive and queue in outbox atomically
      const existingPosts = await this.store.getAll<DearDumbassPost>(POSTS_STORE);

      await this.store.transaction(
        [SYNC_OUTBOX_STORE, SYNC_META_STORE],
        "readwrite",
        async (tx) => {
          await tx.put(SYNC_META_STORE, {
            id: "sync_config",
            enabled: true,
            enabledAt: new Date().toISOString(),
            ownerId: userId,
          });

          for (const post of existingPosts) {
            await tx.put<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE, {
              id: crypto.randomUUID(),
              recordId: post.id,
              action: "upsert",
              queuedAt: new Date().toISOString(),
              attempts: 0,
            });
          }
        },
      );

      this.startPeriodicSync();
      // 4. Trigger initial push
      await this.triggerSync();
    } catch (err: unknown) {
      this.setStatus(
        "error",
        err instanceof Error ? err.message : "Failed to enable sync.",
      );
      throw err;
    }
  }

  /**
   * Second-device unlock:
   * Fetches envelope from cloud, unwraps with passphrase, stores key locally, and pulls cloud archive.
   */
  async unlockSync(passphrase: string): Promise<void> {
    this.setStatus("syncing");
    try {
      const envelope = await this.cloudClient.fetchKeyEnvelope();
      if (!envelope) {
        throw new Error("No encrypted Dear Dumbass envelope found for this account.");
      }

      // Unwraps and persists key locally
      await this.keyManager.unlockWithPassphrase(envelope, passphrase);

      const userId = await this.cloudClient.getAuthUserId();
      await this.store.put(SYNC_META_STORE, {
        id: "sync_config",
        enabled: true,
        enabledAt: new Date().toISOString(),
        ownerId: userId,
      });

      this.startPeriodicSync();
      // Pull all cloud records into local store
      await this.triggerPull(true);
      await this.triggerPush();
      this.setStatus("synced");
    } catch (err: unknown) {
      this.setStatus(
        "locked",
        err instanceof Error ? err.message : "Incorrect passphrase.",
      );
      throw err;
    }
  }

  /**
   * Lock journal on this device:
   * Removes local key material. Cloud data is unchanged.
   */
  async lock(): Promise<void> {
    this.stopPeriodicSync();
    await this.keyManager.lock();
    this.setStatus("locked");
  }

  /**
   * Enqueue a local post mutation to the durable outbox.
   */
  async queueMutation(
    recordId: string,
    tx?: { put<T extends { id: string }>(storeName: string, value: T): Promise<void> },
  ): Promise<void> {
    const item: DearDumbassOutboxItem = {
      id: crypto.randomUUID(),
      recordId,
      action: "upsert",
      queuedAt: new Date().toISOString(),
      attempts: 0,
    };

    if (tx) {
      await tx.put(SYNC_OUTBOX_STORE, item);
    } else {
      await this.store.put(SYNC_OUTBOX_STORE, item);
    }

    if (this.keyManager.isUnlocked()) {
      // Trigger background sync
      void this.triggerSync();
    }
  }

  /**
   * Run full synchronization cycle: push local outbox, pull remote changes.
   */
  async triggerSync(): Promise<void> {
    if (!this.keyManager.isUnlocked()) return;

    if (this.activeSyncPromise) {
      this.queuedSyncRequested = true;
      return this.activeSyncPromise;
    }

    this.activeSyncPromise = this.runSyncLoop();
    try {
      await this.activeSyncPromise;
    } finally {
      this.activeSyncPromise = null;
    }
  }

  private async runSyncLoop(): Promise<void> {
    do {
      this.queuedSyncRequested = false;

      if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && !navigator.onLine) {
        this.setStatus("waiting_to_sync");
        return;
      }

      this.setStatus("syncing");

      try {
        await this.triggerPush();
        await this.triggerPull();

        const conflicts = await this.store.getAll<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE);
        if (conflicts.length > 0) {
          this.setStatus("conflict");
        } else {
          const outbox = await this.store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
          if (outbox.length > 0) {
            this.setStatus("saved_locally");
          } else {
            this.lastSyncedAt = new Date().toISOString();
            this.setStatus("synced");
          }
        }
      } catch (err: unknown) {
        if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && !navigator.onLine) {
          this.setStatus("waiting_to_sync");
        } else {
          this.setStatus(
            "error",
            err instanceof Error ? err.message : "Sync failed.",
          );
        }
      }
    } while (this.queuedSyncRequested);
  }

  /**
   * Process pending outbox mutations and upload encrypted records to Supabase.
   */
  async triggerPush(): Promise<void> {
    if (!this.keyManager.isUnlocked()) return;

    const outboxItems = await this.store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
    if (outboxItems.length === 0) return;

    const masterKey = this.keyManager.getMasterKey();
    const keyVersion = this.keyManager.getKeyVersion();

    for (const item of outboxItems) {
      const post = await this.store.get<DearDumbassPost>(POSTS_STORE, item.recordId);
      if (!post) {
        // Record was removed locally; discard outbox item
        await this.store.delete(SYNC_OUTBOX_STORE, item.id);
        continue;
      }

      const metaKey = `rec_sync_${item.recordId}`;
      const meta = await this.store.get<{ id: string; syncVersion: number }>(
        SYNC_META_STORE,
        metaKey,
      );
      const expectedSyncVersion = meta ? meta.syncVersion : 0;

      const encrypted = await encryptRecord(post, masterKey, keyVersion);

      const result = await this.cloudClient.uploadEncryptedRecord({
        recordId: post.id,
        expectedSyncVersion,
        keyVersion: encrypted.keyVersion,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        encryptionFormatVersion: encrypted.encryptionFormatVersion,
      });

      if (result.status === "ok") {
        await this.store.transaction(
          [SYNC_OUTBOX_STORE, SYNC_META_STORE],
          "readwrite",
          async (tx) => {
            await tx.put(SYNC_META_STORE, {
              id: metaKey,
              recordId: post.id,
              syncVersion: result.syncVersion,
              lastSyncedAt: new Date().toISOString(),
            });
            await tx.delete(SYNC_OUTBOX_STORE, item.id);
          },
        );
      } else if (result.status === "conflict") {
        // CAS conflict: remote has updated. Trigger pull to resolve!
        await this.triggerPull();
        break;
      }
    }
  }

  /**
   * Pull encrypted changes from cloud using incremental server cursor.
   */
  async triggerPull(fromBeginning = false): Promise<void> {
    if (!this.keyManager.isUnlocked()) return;

    const cursorRecord = await this.store.get<{ id: string; lastServerSequence: number }>(
      SYNC_META_STORE,
      "cursor",
    );
    const afterSequence = fromBeginning ? 0 : cursorRecord?.lastServerSequence ?? 0;

    const remoteRecords = await this.cloudClient.pullEncryptedRecords(afterSequence, 100);
    if (remoteRecords.length === 0) return;

    const masterKey = this.keyManager.getMasterKey();
    let highestSequence = afterSequence;
    let hasStoreChanges = false;

    for (const remote of remoteRecords) {
      if (remote.serverChangeSequence && remote.serverChangeSequence > highestSequence) {
        highestSequence = remote.serverChangeSequence;
      }

      let decryptedIncoming: DearDumbassPost;
      try {
        decryptedIncoming = await decryptRecord(
          {
            recordId: remote.recordId,
            ciphertext: remote.ciphertext,
            iv: remote.iv,
            keyVersion: remote.keyVersion,
          },
          masterKey,
        );
      } catch {
        // Decryption or invariant validation failed; skip corrupted record safely
        continue;
      }

      const local = await this.store.get<DearDumbassPost>(POSTS_STORE, decryptedIncoming.id);
      const outboxForRecord = await this.store.getAllByIndex<DearDumbassOutboxItem>(
        SYNC_OUTBOX_STORE,
        "by_recordId",
        decryptedIncoming.id,
      );
      const hasLocalPendingChanges = outboxForRecord.length > 0;

      let postToSave: DearDumbassPost | null = null;
      let shouldQueueTombstonePush = false;

      if (!local) {
        // New record from another device
        postToSave = decryptedIncoming;
      } else {
        const localDeleted = Boolean(local.deletedAt);
        const incomingDeleted = Boolean(decryptedIncoming.deletedAt);

        if (incomingDeleted) {
          // Incoming is tombstone -> tombstone dominates live versions!
          postToSave = {
            ...local,
            body: "",
            revision: Math.max(local.revision ?? 0, decryptedIncoming.revision ?? 0),
            deletedAt: decryptedIncoming.deletedAt,
          };
        } else if (localDeleted) {
          // Local is tombstone -> local tombstone dominates!
          // We must ensure remote gets our local tombstone
          shouldQueueTombstonePush = true;
        } else {
          // Both are live records
          const localRev = local.revision ?? 0;
          const incomingRev = decryptedIncoming.revision ?? 0;

          if (incomingRev > localRev && !hasLocalPendingChanges) {
            postToSave = decryptedIncoming;
          } else if (localRev > incomingRev) {
            // Local is newer; retain local
          } else if (local.body !== decryptedIncoming.body && hasLocalPendingChanges) {
            // Both devices made concurrent live edits from same base version!
            await this.store.put<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE, {
              id: decryptedIncoming.id,
              localPost: local,
              remotePost: decryptedIncoming,
              detectedAt: new Date().toISOString(),
            });
            this.setStatus("conflict");
          } else {
            // Identical
            postToSave = decryptedIncoming;
          }
        }
      }

      if (postToSave) {
        hasStoreChanges = true;
        const metaKey = `rec_sync_${postToSave.id}`;

        await this.store.transaction(
          [POSTS_STORE, SYNC_META_STORE, SYNC_CONFLICTS_STORE],
          "readwrite",
          async (tx) => {
            await tx.put(POSTS_STORE, postToSave!);

            // If root post is deleted, scrub all child replies locally
            if (postToSave!.deletedAt && !postToSave!.replyToId) {
              const replies = await tx.getAllByIndex<DearDumbassPost>(
                POSTS_STORE,
                "by_replyToId",
                postToSave!.id,
              );
              for (const rep of replies) {
                if (!rep.deletedAt) {
                  await tx.put(POSTS_STORE, {
                    ...rep,
                    body: "",
                    updatedAt: postToSave!.deletedAt,
                    revision: (rep.revision ?? 0) + 1,
                    deletedAt: postToSave!.deletedAt,
                  });
                }
              }
            }

            await tx.put(SYNC_META_STORE, {
              id: metaKey,
              recordId: postToSave!.id,
              syncVersion: remote.syncVersion,
              lastSyncedAt: new Date().toISOString(),
            });
            await tx.delete(SYNC_CONFLICTS_STORE, postToSave!.id);
          },
        );
      }

      if (shouldQueueTombstonePush) {
        await this.queueMutation(local!.id);
      }
    }

    // Update cursor
    await this.store.put(SYNC_META_STORE, {
      id: "cursor",
      lastServerSequence: highestSequence,
      updatedAt: new Date().toISOString(),
    });

    if (hasStoreChanges && this.onPostStoreMutated) {
      this.onPostStoreMutated();
    }
  }

  /**
   * Resolve an active conflict by choosing either the local or remote version.
   */
  async resolveConflict(recordId: string, resolution: "local" | "remote"): Promise<void> {
    const conflict = await this.store.get<DearDumbassSyncConflict>(
      SYNC_CONFLICTS_STORE,
      recordId,
    );
    if (!conflict) return;

    const chosen = resolution === "local" ? conflict.localPost : conflict.remotePost;
    const maxRev = Math.max(
      conflict.localPost.revision ?? 0,
      conflict.remotePost.revision ?? 0,
    );

    const resolvedPost: DearDumbassPost = {
      ...chosen,
      revision: maxRev + 1,
      updatedAt: new Date().toISOString(),
    };

    await this.store.transaction(
      [POSTS_STORE, SYNC_OUTBOX_STORE, SYNC_CONFLICTS_STORE],
      "readwrite",
      async (tx) => {
        await tx.put(POSTS_STORE, resolvedPost);
        await tx.delete(SYNC_CONFLICTS_STORE, recordId);
        await tx.put<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE, {
          id: crypto.randomUUID(),
          recordId,
          action: "upsert",
          queuedAt: new Date().toISOString(),
          attempts: 0,
        });
      },
    );

    if (this.onPostStoreMutated) {
      this.onPostStoreMutated();
    }

    void this.triggerSync();
  }
}
