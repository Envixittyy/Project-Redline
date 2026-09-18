import type { PrivateStore } from "@/services/private-store";

import type { DearDumbassPost } from "../types";
import {
  decryptRecord,
  encryptRecord,
} from "./crypto";
import type { DearDumbassCloudClient } from "./cloud-client";
import { SupabaseDearDumbassCloudClient } from "./cloud-client";
import {
  DearDumbassKeyManager,
  LOCAL_KEYS_STORE,
} from "./key-manager";
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
const PULL_PAGE_SIZE = 100;

type RecordSyncMeta = {
  id: string;
  recordId: string;
  syncVersion: number;
  lastSyncedAt: string;
};

type SyncConfig = {
  id: "sync_config";
  enabled: boolean;
  enabledAt: string;
  ownerId: string;
};

function postsAreIdentical(a: DearDumbassPost, b: DearDumbassPost): boolean {
  return (
    a.id === b.id &&
    a.body === b.body &&
    a.createdAt === b.createdAt &&
    (a.updatedAt ?? null) === (b.updatedAt ?? null) &&
    (a.revision ?? 0) === (b.revision ?? 0) &&
    a.replyToId === b.replyToId &&
    (a.deletedAt ?? null) === (b.deletedAt ?? null)
  );
}

function assertSameRecordIdentity(a: DearDumbassPost, b: DearDumbassPost): void {
  if (a.id !== b.id || a.createdAt !== b.createdAt || a.replyToId !== b.replyToId) {
    throw new Error("Encrypted sync record changed immutable journal identity.");
  }
}

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
  private lifecycleGeneration = 0;

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

  private async setSettledSyncStatus(): Promise<void> {
    const [conflicts, outbox] = await Promise.all([
      this.store.getAll<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE),
      this.store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE),
    ]);
    if (conflicts.length > 0) {
      this.setStatus("conflict");
    } else if (outbox.length > 0) {
      this.setStatus("saved_locally");
    } else {
      this.lastSyncedAt = new Date().toISOString();
      this.setStatus("synced");
    }
  }

  /**
   * Initialize coordinator on app/feed load.
   * Checks local key, cloud key envelope, and triggers initial sync if enabled.
   */
  async initialize(): Promise<void> {
    try {
      const userId = await this.cloudClient.getAuthUserId();

      if (!userId) {
        this.lifecycleGeneration += 1;
        await this.keyManager.lock().catch(() => undefined);
        this.setStatus("local_only");
        return;
      }

      const syncConfig = await this.store.get<SyncConfig>(SYNC_META_STORE, "sync_config");
      if (syncConfig?.ownerId && syncConfig.ownerId !== userId) {
        this.lifecycleGeneration += 1;
        await this.keyManager.lock().catch(() => undefined);
        this.setStatus(
          "error",
          "This browser contains a local journal configured for a different account.",
        );
        return;
      }

      const isUnlocked = await this.keyManager.loadLocalKey(userId);

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

      if (isUnlocked && envelope) {
        this.setStatus("synced");
        void this.triggerSync();
        this.startPeriodicSync();
      } else if (syncConfig?.enabled) {
        this.setStatus("error", "Encrypted sync is configured locally but its cloud envelope is missing.");
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
    let envelopeCreated = false;
    let cloudEnvelopeAvailable = false;
    try {
      const userId = await this.cloudClient.getAuthUserId();
      if (!userId) {
        throw new Error("You must be signed in to Adulting.exe to enable encrypted sync.");
      }

      const existingEnvelope = await this.cloudClient.fetchKeyEnvelope();
      if (existingEnvelope) {
        cloudEnvelopeAvailable = true;
        throw new Error(
          "Encrypted sync is already configured for this account. Unlock it with the existing passphrase.",
        );
      }

      // 1. Generate an extractable byte key only long enough to wrap it, then retain
      // the non-extractable CryptoKey returned by Web Crypto.
      const { masterKey, envelope } = await this.keyManager.createNewMasterKey(
        passphrase,
        userId,
      );

      // 2. Create (never overwrite) the cloud key envelope.
      try {
        await this.cloudClient.uploadKeyEnvelope(envelope);
      } catch (uploadError) {
        cloudEnvelopeAvailable = Boolean(
          await this.cloudClient.fetchKeyEnvelope().catch(() => null),
        );
        throw uploadError;
      }
      envelopeCreated = true;

      // 3. Persist the local key, enable sync, and snapshot every existing local
      // record into the outbox in one IndexedDB transaction.
      await this.store.transaction(
        [POSTS_STORE, SYNC_OUTBOX_STORE, SYNC_META_STORE, LOCAL_KEYS_STORE],
        "readwrite",
        async (tx) => {
          const existingPosts = await tx.getAll<DearDumbassPost>(POSTS_STORE);
          const now = new Date().toISOString();
          await tx.put(LOCAL_KEYS_STORE, this.keyManager.createStoredKeyRecord(
            masterKey,
            envelope.keyVersion,
            userId,
          ));
          await tx.put<SyncConfig>(SYNC_META_STORE, {
            id: "sync_config",
            enabled: true,
            enabledAt: now,
            ownerId: userId,
          });

          for (const post of existingPosts) {
            await tx.put<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE, {
              id: crypto.randomUUID(),
              recordId: post.id,
              action: "upsert",
              queuedAt: now,
              attempts: 0,
            });
          }
        },
      );

      this.keyManager.activateKey(masterKey, envelope.keyVersion);
      this.lifecycleGeneration += 1;

      this.startPeriodicSync();
      // 4. Trigger initial push
      await this.triggerSync();
    } catch (err: unknown) {
      this.setStatus(
        envelopeCreated || cloudEnvelopeAvailable ? "locked" : "error",
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
      const userId = await this.cloudClient.getAuthUserId();
      if (!userId) {
        throw new Error("You must be signed in to unlock encrypted sync.");
      }
      const envelope = await this.cloudClient.fetchKeyEnvelope();
      if (!envelope) {
        throw new Error("No encrypted Dear Dumbass envelope found for this account.");
      }

      const masterKey = await this.keyManager.unwrapWithPassphrase(
        envelope,
        passphrase,
        userId,
      );

      await this.store.transaction(
        [POSTS_STORE, SYNC_OUTBOX_STORE, SYNC_META_STORE, LOCAL_KEYS_STORE],
        "readwrite",
        async (tx) => {
          const existingConfig = await tx.get<SyncConfig>(SYNC_META_STORE, "sync_config");
          if (existingConfig?.ownerId && existingConfig.ownerId !== userId) {
            throw new Error("This browser contains a journal owned by a different account.");
          }
          const localPosts = await tx.getAll<DearDumbassPost>(POSTS_STORE);
          const now = new Date().toISOString();
          await tx.put(LOCAL_KEYS_STORE, this.keyManager.createStoredKeyRecord(
            masterKey,
            envelope.keyVersion,
            userId,
          ));
          await tx.put<SyncConfig>(SYNC_META_STORE, {
            id: "sync_config",
            enabled: true,
            enabledAt: existingConfig?.enabledAt ?? now,
            ownerId: userId,
          });
          for (const post of localPosts) {
            const pending = await tx.getAllByIndex<DearDumbassOutboxItem>(
              SYNC_OUTBOX_STORE,
              "by_recordId",
              post.id,
            );
            if (pending.length === 0) {
              await tx.put<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE, {
                id: crypto.randomUUID(),
                recordId: post.id,
                action: "upsert",
                queuedAt: now,
                attempts: 0,
              });
            }
          }
        },
      );
      this.keyManager.activateKey(masterKey, envelope.keyVersion);
      this.lifecycleGeneration += 1;

      this.startPeriodicSync();
      // Pull all cloud records into local store
      await this.triggerPull(true);
      await this.triggerPush();
      await this.setSettledSyncStatus();
    } catch (err: unknown) {
      this.setStatus(
        this.keyManager.isUnlocked() ? "error" : "locked",
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
    this.lifecycleGeneration += 1;
    this.queuedSyncRequested = false;
    this.stopPeriodicSync();
    try {
      await this.keyManager.lock();
      this.setStatus("locked");
    } catch (error) {
      this.setStatus(
        "error",
        "The in-memory sync key was cleared, but its IndexedDB copy could not be removed.",
      );
      throw error;
    }
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

    const generation = this.lifecycleGeneration;
    this.activeSyncPromise = this.runSyncLoop(generation);
    try {
      await this.activeSyncPromise;
    } finally {
      this.activeSyncPromise = null;
    }
  }

  private async runSyncLoop(generation: number): Promise<void> {
    do {
      if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;
      this.queuedSyncRequested = false;

      if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && !navigator.onLine) {
        this.setStatus("waiting_to_sync");
        return;
      }

      this.setStatus("syncing");

      try {
        await this.triggerPush();
        await this.triggerPull();
        if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;

        await this.setSettledSyncStatus();
      } catch (err: unknown) {
        if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;
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
    const generation = this.lifecycleGeneration;
    const visitedRecords = new Set<string>();

    for (const item of outboxItems) {
      if (visitedRecords.has(item.recordId)) continue;
      visitedRecords.add(item.recordId);
      if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;

      const snapshot = await this.store.transaction(
        [POSTS_STORE, SYNC_OUTBOX_STORE, SYNC_META_STORE, SYNC_CONFLICTS_STORE],
        "readonly",
        async (tx) => ({
          post: await tx.get<DearDumbassPost>(POSTS_STORE, item.recordId),
          pending: await tx.getAllByIndex<DearDumbassOutboxItem>(
            SYNC_OUTBOX_STORE,
            "by_recordId",
            item.recordId,
          ),
          meta: await tx.get<RecordSyncMeta>(SYNC_META_STORE, `rec_sync_${item.recordId}`),
          conflict: await tx.get<DearDumbassSyncConflict>(
            SYNC_CONFLICTS_STORE,
            item.recordId,
          ),
        }),
      );

      if (snapshot.conflict) {
        continue;
      }

      if (snapshot.pending.length === 0) continue;

      if (!snapshot.post) {
        await this.store.transaction(SYNC_OUTBOX_STORE, "readwrite", (tx) =>
          tx.deleteBatch(
            SYNC_OUTBOX_STORE,
            snapshot.pending.map((pending) => pending.id),
          ),
        );
        continue;
      }

      const metaKey = `rec_sync_${item.recordId}`;
      const expectedSyncVersion = snapshot.meta?.syncVersion ?? 0;

      const encrypted = await encryptRecord(snapshot.post, masterKey, keyVersion);
      if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;

      const result = await this.cloudClient.uploadEncryptedRecord({
        recordId: snapshot.post.id,
        expectedSyncVersion,
        keyVersion: encrypted.keyVersion,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        encryptionFormatVersion: encrypted.encryptionFormatVersion,
      });
      if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) {
        return;
      }

      if (result.status === "ok") {
        await this.store.transaction(
          [SYNC_OUTBOX_STORE, SYNC_META_STORE],
          "readwrite",
          async (tx) => {
            const currentMeta = await tx.get<RecordSyncMeta>(SYNC_META_STORE, metaKey);
            await tx.put<RecordSyncMeta>(SYNC_META_STORE, {
              id: metaKey,
              recordId: snapshot.post!.id,
              syncVersion: Math.max(currentMeta?.syncVersion ?? 0, result.syncVersion),
              lastSyncedAt: new Date().toISOString(),
            });
            await tx.deleteBatch(
              SYNC_OUTBOX_STORE,
              snapshot.pending.map((pending) => pending.id),
            );
          },
        );
      } else if (result.status === "conflict") {
        await this.triggerPull();
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
    let afterSequence = fromBeginning ? 0 : cursorRecord?.lastServerSequence ?? 0;
    const masterKey = this.keyManager.getMasterKey();
    const generation = this.lifecycleGeneration;
    let anyStoreChanges = false;

    for (;;) {
      if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;
      const remoteRecords = await this.cloudClient.pullEncryptedRecords(
        afterSequence,
        PULL_PAGE_SIZE,
      );
      if (remoteRecords.length === 0) break;

      let previousSequence = afterSequence;
      const decryptedPage: Array<{
        remote: (typeof remoteRecords)[number];
        post: DearDumbassPost;
        sequence: number;
      }> = [];

      for (const remote of remoteRecords) {
        const sequence = remote.serverChangeSequence;
        if (
          !Number.isSafeInteger(sequence) ||
          sequence === undefined ||
          sequence <= previousSequence ||
          !Number.isSafeInteger(remote.syncVersion) ||
          remote.syncVersion < 1
        ) {
          throw new Error("Cloud sync returned an invalid or unordered change cursor.");
        }
        previousSequence = sequence;
        const post = await decryptRecord(
          {
            recordId: remote.recordId,
            ciphertext: remote.ciphertext,
            iv: remote.iv,
            keyVersion: remote.keyVersion,
            encryptionFormatVersion: remote.encryptionFormatVersion,
          },
          masterKey,
        );
        decryptedPage.push({ remote, post, sequence });
      }

      if (generation !== this.lifecycleGeneration || !this.keyManager.isUnlocked()) return;
      let pageChanged = false;
      await this.store.transaction(
        [POSTS_STORE, SYNC_OUTBOX_STORE, SYNC_META_STORE, SYNC_CONFLICTS_STORE],
        "readwrite",
        async (tx) => {
          const queueIfMissing = async (recordId: string, now: string) => {
            const pending = await tx.getAllByIndex<DearDumbassOutboxItem>(
              SYNC_OUTBOX_STORE,
              "by_recordId",
              recordId,
            );
            if (pending.length === 0) {
              await tx.put<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE, {
                id: crypto.randomUUID(),
                recordId,
                action: "upsert",
                queuedAt: now,
                attempts: 0,
              });
            }
          };

          for (const { remote, post: incoming, sequence } of decryptedPage) {
            const now = new Date().toISOString();
            const local = await tx.get<DearDumbassPost>(POSTS_STORE, incoming.id);
            const pending = await tx.getAllByIndex<DearDumbassOutboxItem>(
              SYNC_OUTBOX_STORE,
              "by_recordId",
              incoming.id,
            );
            const recordMeta = await tx.get<RecordSyncMeta>(
              SYNC_META_STORE,
              `rec_sync_${incoming.id}`,
            );
            let postToSave: DearDumbassPost | null = null;
            let conflict: DearDumbassSyncConflict | null = null;

            if (!local) {
              if (incoming.replyToId) {
                const parent = await tx.get<DearDumbassPost>(POSTS_STORE, incoming.replyToId);
                if (parent?.deletedAt && !incoming.deletedAt) {
                  postToSave = {
                    ...incoming,
                    body: "",
                    updatedAt: parent.deletedAt,
                    revision: (incoming.revision ?? 0) + 1,
                    deletedAt: parent.deletedAt,
                  };
                  await queueIfMissing(incoming.id, now);
                } else {
                  postToSave = incoming;
                }
              } else {
                postToSave = incoming;
              }
            } else {
              assertSameRecordIdentity(local, incoming);
              const localDeleted = Boolean(local.deletedAt);
              const incomingDeleted = Boolean(incoming.deletedAt);

              if (incomingDeleted) {
                postToSave = {
                  ...incoming,
                  body: "",
                  revision: Math.max(local.revision ?? 0, incoming.revision ?? 0),
                };
                await tx.deleteBatch(
                  SYNC_OUTBOX_STORE,
                  pending.map((entry) => entry.id),
                );
              } else if (localDeleted) {
                await queueIfMissing(local.id, now);
              } else if (postsAreIdentical(local, incoming)) {
                postToSave = incoming;
                await tx.deleteBatch(
                  SYNC_OUTBOX_STORE,
                  pending.map((entry) => entry.id),
                );
              } else if (
                pending.length > 0 &&
                remote.syncVersion <= (recordMeta?.syncVersion ?? 0)
              ) {
                // This is an already-acknowledged cloud baseline. A newer local
                // mutation was queued while that upload was in flight, so keep
                // the local record and let its durable outbox entry advance CAS.
              } else if (pending.length > 0) {
                conflict = {
                  id: incoming.id,
                  localPost: local,
                  remotePost: incoming,
                  remoteSyncVersion: remote.syncVersion,
                  remoteServerChangeSequence: sequence,
                  detectedAt: now,
                };
              } else if ((incoming.revision ?? 0) > (local.revision ?? 0)) {
                postToSave = incoming;
              } else if ((local.revision ?? 0) > (incoming.revision ?? 0)) {
                await queueIfMissing(local.id, now);
              } else {
                conflict = {
                  id: incoming.id,
                  localPost: local,
                  remotePost: incoming,
                  remoteSyncVersion: remote.syncVersion,
                  remoteServerChangeSequence: sequence,
                  detectedAt: now,
                };
              }
            }

            if (postToSave) {
              await tx.put(POSTS_STORE, postToSave);
              await tx.delete(SYNC_CONFLICTS_STORE, postToSave.id);
              pageChanged = true;

              if (postToSave.deletedAt && !postToSave.replyToId) {
                const replies = await tx.getAllByIndex<DearDumbassPost>(
                  POSTS_STORE,
                  "by_replyToId",
                  postToSave.id,
                );
                for (const reply of replies) {
                  await tx.delete(SYNC_CONFLICTS_STORE, reply.id);
                  if (!reply.deletedAt) {
                    await tx.put(POSTS_STORE, {
                      ...reply,
                      body: "",
                      updatedAt: postToSave.deletedAt,
                      revision: (reply.revision ?? 0) + 1,
                      deletedAt: postToSave.deletedAt,
                    });
                    await queueIfMissing(reply.id, now);
                    pageChanged = true;
                  }
                }
              }
            }

            if (conflict) {
              await tx.put<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE, conflict);
            }

            await tx.put<RecordSyncMeta>(SYNC_META_STORE, {
              id: `rec_sync_${incoming.id}`,
              recordId: incoming.id,
              syncVersion: remote.syncVersion,
              lastSyncedAt: now,
            });
          }

          await tx.put(SYNC_META_STORE, {
            id: "cursor",
            lastServerSequence: previousSequence,
            updatedAt: new Date().toISOString(),
          });
        },
      );

      anyStoreChanges ||= pageChanged;
      afterSequence = previousSequence;
      if (remoteRecords.length < PULL_PAGE_SIZE) break;
    }

    if (anyStoreChanges && this.onPostStoreMutated) this.onPostStoreMutated();
  }

  /**
   * Resolve an active conflict by choosing either the local or remote version.
   */
  async resolveConflict(recordId: string, resolution: "local" | "remote"): Promise<void> {
    let didResolve = false;
    await this.store.transaction(
      [POSTS_STORE, SYNC_OUTBOX_STORE, SYNC_META_STORE, SYNC_CONFLICTS_STORE],
      "readwrite",
      async (tx) => {
        const conflict = await tx.get<DearDumbassSyncConflict>(
          SYNC_CONFLICTS_STORE,
          recordId,
        );
        if (!conflict) return;
        const chosen = resolution === "local" ? conflict.localPost : conflict.remotePost;
        const resolvedPost: DearDumbassPost = {
          ...chosen,
          revision:
            Math.max(
              conflict.localPost.revision ?? 0,
              conflict.remotePost.revision ?? 0,
            ) + 1,
          updatedAt: new Date().toISOString(),
        };
        const pending = await tx.getAllByIndex<DearDumbassOutboxItem>(
          SYNC_OUTBOX_STORE,
          "by_recordId",
          recordId,
        );
        await tx.put(POSTS_STORE, resolvedPost);
        await tx.put<RecordSyncMeta>(SYNC_META_STORE, {
          id: `rec_sync_${recordId}`,
          recordId,
          syncVersion: conflict.remoteSyncVersion,
          lastSyncedAt: new Date().toISOString(),
        });
        await tx.deleteBatch(
          SYNC_OUTBOX_STORE,
          pending.map((entry) => entry.id),
        );
        await tx.delete(SYNC_CONFLICTS_STORE, recordId);
        await tx.put<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE, {
          id: crypto.randomUUID(),
          recordId,
          action: "upsert",
          queuedAt: new Date().toISOString(),
          attempts: 0,
        });
        didResolve = true;
      },
    );

    if (!didResolve) return;

    if (this.onPostStoreMutated) {
      this.onPostStoreMutated();
    }

    this.setStatus("saved_locally");
    void this.triggerSync();
  }
}
