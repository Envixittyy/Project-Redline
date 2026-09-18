import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import { DearDumbassRepository } from "../dear-dumbass-repository";
import type { DearDumbassPost } from "../types";
import type { DearDumbassCloudClient } from "./cloud-client";
import { LOCAL_KEYS_STORE } from "./key-manager";
import {
  DearDumbassSyncCoordinator,
  POSTS_STORE,
  SYNC_CONFLICTS_STORE,
  SYNC_META_STORE,
  SYNC_OUTBOX_STORE,
} from "./sync-coordinator";
import type {
  DearDumbassEncryptedRecord,
  DearDumbassKeyEnvelope,
  DearDumbassOutboxItem,
  DearDumbassSyncConflict,
} from "./types";

class MockDearDumbassCloudClient implements DearDumbassCloudClient {
  public userId: string | null = "user-test-123";
  public envelope: DearDumbassKeyEnvelope | null = null;
  public records = new Map<string, DearDumbassEncryptedRecord>();
  public changeSeq = 0;
  public failNextUpload = false;
  public beforeRecordUpload:
    | ((params: {
        recordId: string;
        expectedSyncVersion: number;
      }) => Promise<void> | void)
    | null = null;

  async getAuthUserId(): Promise<string | null> {
    return this.userId;
  }

  async fetchKeyEnvelope(): Promise<DearDumbassKeyEnvelope | null> {
    return this.envelope ? structuredClone(this.envelope) : null;
  }

  async uploadKeyEnvelope(envelope: DearDumbassKeyEnvelope): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("Network simulated failure on envelope upload");
    }
    if (this.envelope) {
      throw new Error("Encrypted sync is already configured for this account.");
    }
    this.envelope = structuredClone(envelope);
  }

  async uploadEncryptedRecord(params: {
    recordId: string;
    expectedSyncVersion: number;
    keyVersion: number;
    ciphertext: string;
    iv: string;
    encryptionFormatVersion: number;
  }): Promise<{
    status: "ok" | "conflict";
    syncVersion: number;
    serverChangeSequence?: number;
    currentSyncVersion?: number;
    message?: string;
  }> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("Network simulated failure on record upload");
    }

    const beforeUpload = this.beforeRecordUpload;
    this.beforeRecordUpload = null;
    await beforeUpload?.({
      recordId: params.recordId,
      expectedSyncVersion: params.expectedSyncVersion,
    });

    const existing = this.records.get(params.recordId);
    if (!existing) {
      if (params.expectedSyncVersion !== 0) {
        return {
          status: "conflict",
          syncVersion: 0,
          currentSyncVersion: 0,
          message: "Record does not exist in cloud",
        };
      }
      this.changeSeq += 1;
      const newRecord: DearDumbassEncryptedRecord = {
        recordId: params.recordId,
        keyVersion: params.keyVersion,
        syncVersion: 1,
        ciphertext: params.ciphertext,
        iv: params.iv,
        encryptionFormatVersion: params.encryptionFormatVersion,
        serverChangeSequence: this.changeSeq,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.records.set(params.recordId, newRecord);
      return {
        status: "ok",
        syncVersion: 1,
        serverChangeSequence: this.changeSeq,
      };
    }

    // Existing record: CAS check
    if (existing.syncVersion !== params.expectedSyncVersion) {
      return {
        status: "conflict",
        syncVersion: existing.syncVersion,
        currentSyncVersion: existing.syncVersion,
        serverChangeSequence: existing.serverChangeSequence,
        message: "Sync version conflict",
      };
    }

    this.changeSeq += 1;
    existing.keyVersion = params.keyVersion;
    existing.syncVersion += 1;
    existing.ciphertext = params.ciphertext;
    existing.iv = params.iv;
    existing.encryptionFormatVersion = params.encryptionFormatVersion;
    existing.serverChangeSequence = this.changeSeq;
    existing.updatedAt = new Date().toISOString();

    return {
      status: "ok",
      syncVersion: existing.syncVersion,
      serverChangeSequence: this.changeSeq,
    };
  }

  async pullEncryptedRecords(
    afterSequence: number,
    limit: number = 100,
  ): Promise<DearDumbassEncryptedRecord[]> {
    const matching: DearDumbassEncryptedRecord[] = [];
    for (const record of this.records.values()) {
      if ((record.serverChangeSequence ?? 0) > afterSequence) {
        matching.push(structuredClone(record));
      }
    }
    return matching
      .sort((a, b) => (a.serverChangeSequence ?? 0) - (b.serverChangeSequence ?? 0))
      .slice(0, limit);
  }
}

describe("Dear Dumbass E2EE Sync Coordinator", () => {
  const passphrase = "sync-test-passphrase-secure";
  let sharedCloud: MockDearDumbassCloudClient;

  beforeEach(() => {
    sharedCloud = new MockDearDumbassCloudClient();
  });

  it("1. First-device migration: uploads existing local posts and preserves local data", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);

    // Create 2 existing local posts and 1 reply before enabling sync
    const post1 = await repoA.createPost("Pre-existing post 1");
    const post2 = await repoA.createPost("Pre-existing post 2");
    const reply1 = await repoA.createPost("Pre-existing reply to 1", post1.id);

    expect(await repoA.getFeed()).toHaveLength(2);

    // Enable sync on first device
    await coordA.enableSync(passphrase);

    // Verify key envelope exists in cloud
    expect(sharedCloud.envelope).toBeDefined();
    expect(sharedCloud.envelope?.kdf.algorithm).toBe("PBKDF2");

    // Verify all 3 records were encrypted and uploaded to cloud
    expect(sharedCloud.records.size).toBe(3);
    expect(sharedCloud.records.has(post1.id)).toBe(true);
    expect(sharedCloud.records.has(post2.id)).toBe(true);
    expect(sharedCloud.records.has(reply1.id)).toBe(true);

    // Verify cloud has zero plaintext
    for (const rec of sharedCloud.records.values()) {
      expect(rec.ciphertext).not.toContain("Pre-existing");
      expect(rec.ciphertext.length).toBeGreaterThan(20);
    }

    // Verify local posts are 100% preserved
    const feedAfter = await repoA.getFeed();
    expect(feedAfter).toHaveLength(2);
    const replies = await repoA.getReplies(post1.id);
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe(reply1.id);

    // Verify outbox is emptied
    const outbox = await storeA.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
    expect(outbox).toHaveLength(0);
    expect(coordA.getState().status).toBe("synced");
  });

  it("2. Second-device bootstrap: downloads envelope, decrypts records, populates store", async () => {
    // Setup Device A and create content
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    const postA = await repoA.createPost("Device A thought");
    await repoA.createPost("Device A reply", postA.id);
    await coordA.enableSync(passphrase);

    // Now Setup Device B (fresh, empty store)
    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);

    expect(await repoB.getFeed()).toHaveLength(0);

    // Initialize Device B -> detects locked state
    await coordB.initialize();
    expect(coordB.getState().status).toBe("locked");

    // Unlock with correct passphrase
    await coordB.unlockSync(passphrase);
    expect(coordB.getState().status).toBe("synced");

    // Verify posts decrypted locally on Device B
    const feedB = await repoB.getFeed();
    expect(feedB).toHaveLength(1);
    expect(feedB[0].id).toBe(postA.id);
    expect(feedB[0].body).toBe("Device A thought");

    const repliesB = await repoB.getReplies(postA.id);
    expect(repliesB).toHaveLength(1);
    expect(repliesB[0].body).toBe("Device A reply");
  });

  it("3. Second-device wrong passphrase causes zero mutation and remains locked", async () => {
    // Device A sets up sync
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await repoA.createPost("Secret text");
    await coordA.enableSync(passphrase);

    // Device B with pre-existing local note
    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await repoB.createPost("Device B existing note");

    await expect(coordB.unlockSync("wrong-passphrase")).rejects.toThrow();

    // Verify Device B local store has zero unwanted mutations
    const feedB = await repoB.getFeed();
    expect(feedB).toHaveLength(1);
    expect(feedB[0].body).toBe("Device B existing note");
    expect(coordB.getState().status).toBe("locked");
  });

  it("4. Device A create -> Device B receives and Device B reply -> Device A receives", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);

    // Device A creates post
    const postFromA = await repoA.createPost("Hello from Device A");
    // Device A syncs
    await coordA.triggerSync();

    // Device B pulls
    await coordB.triggerPull();
    const feedB = await repoB.getFeed();
    expect(feedB.some((p) => p.id === postFromA.id)).toBe(true);

    // Device B replies to postFromA
    const replyFromB = await repoB.createPost("Reply from Device B", postFromA.id);
    await coordB.triggerSync();

    // Device A pulls
    await coordA.triggerPull();
    const repliesOnA = await repoA.getReplies(postFromA.id);
    expect(repliesOnA.some((r) => r.id === replyFromB.id)).toBe(true);
  });

  it("5. Edits synchronize accurately across devices", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);

    const post = await repoA.createPost("Original text");
    await coordA.triggerSync();
    await coordB.triggerPull();

    // Device A edits post
    const updated = await repoA.updatePost(post.id, "Edited text by Device A");
    expect(updated.revision).toBe(1);
    await coordA.triggerSync();

    // Device B pulls update
    await coordB.triggerPull();
    const postOnB = await repoB.getPost(post.id);
    expect(postOnB?.body).toBe("Edited text by Device A");
    expect(postOnB?.revision).toBe(1);
  });

  it("6. Deletion synchronization: root deletion cascades and scrubs replies on remote device", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);

    const root = await repoA.createPost("Root to be deleted");
    const reply = await repoA.createPost("Child reply", root.id);
    await coordA.triggerSync();
    await coordB.triggerPull();

    expect(await repoB.getFeed()).toHaveLength(1);
    expect(await repoB.getReplies(root.id)).toHaveLength(1);

    // Device A deletes root post
    await repoA.deletePost(root.id);
    await coordA.triggerSync();

    // Device B pulls remote deletion
    await coordB.triggerPull();

    // On Device B, root post and reply must be removed from active feed and scrubbed
    expect(await repoB.getFeed()).toHaveLength(0);
    expect(await repoB.getReplies(root.id)).toHaveLength(0);

    const rootInStoreB = await storeB.get<DearDumbassPost>(POSTS_STORE, root.id);
    expect(rootInStoreB?.deletedAt).toBeTruthy();
    expect(rootInStoreB?.body).toBe("");

    const replyInStoreB = await storeB.get<DearDumbassPost>(POSTS_STORE, reply.id);
    expect(replyInStoreB?.deletedAt).toBeTruthy();
    expect(replyInStoreB?.body).toBe("");
  });

  it("7. Tombstone dominates stale live mutation from older device", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);

    const post = await repoA.createPost("Will be deleted by A");
    await coordA.triggerSync();
    await coordB.triggerPull();

    // Device A deletes post
    await repoA.deletePost(post.id);
    await coordA.triggerSync();

    // Device B pulls: tombstone dominates and scrubs body
    await coordB.triggerPull();
    expect(await repoB.getPost(post.id)).toBeNull();
    const postOnB = await storeB.get<DearDumbassPost>(POSTS_STORE, post.id);
    expect(postOnB?.body).toBe("");
    expect(postOnB?.deletedAt).toBeTruthy();
  });

  it("8. Concurrent live/live edits on both devices preserve conflict without silent data loss", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);

    const basePost = await repoA.createPost("Base content");
    await coordA.triggerSync();
    await coordB.triggerPull();

    // Both devices edit offline concurrently from base revision 0
    await repoA.updatePost(basePost.id, "Device A concurrent edit");
    await repoB.updatePost(basePost.id, "Device B concurrent edit");

    // Device A uploads its edit (advancing cloud sync_version to 2)
    await coordA.triggerSync();

    // Device B attempts to push its edit (with expected_sync_version = 1) -> CAS conflict!
    // Device B pulls Device A's edit -> detects concurrent live edit conflict
    await coordB.triggerSync();

    expect(coordB.getState().status).toBe("conflict");
    const conflicts = await storeB.getAll<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].localPost.body).toBe("Device B concurrent edit");
    expect(conflicts[0].remotePost.body).toBe("Device A concurrent edit");

    // Neither version was lost!
    // Device B resolves conflict choosing local version
    await coordB.resolveConflict(basePost.id, "local");
    expect(coordB.getState().status).not.toBe("conflict");

    const resolvedPost = await repoB.getPost(basePost.id);
    expect(resolvedPost?.body).toBe("Device B concurrent edit");
    expect(resolvedPost?.revision).toBe(2);
  });

  it("9. Offline outbox survives page reload and syncs when reconnected", async () => {
    const store = new InMemoryPrivateStore();
    const coord = new DearDumbassSyncCoordinator({
      store,
      cloudClient: sharedCloud,
    });
    const repo = new DearDumbassRepository(store, coord);
    await coord.enableSync(passphrase);

    // Simulate offline network failure
    sharedCloud.failNextUpload = true;

    // Create post while network fails
    const post = await repo.createPost("Offline note");

    // Outbox has pending mutation
    const outbox = await store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].recordId).toBe(post.id);

    // Network recovers -> triggerSync
    await coord.triggerSync();

    // Outbox emptied and uploaded
    const outboxAfter = await store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
    expect(outboxAfter).toHaveLength(0);
    expect(sharedCloud.records.has(post.id)).toBe(true);
    expect(coord.getState().status).toBe("synced");
  });

  it("10. Removing the sync key does not misrepresent or erase local plaintext", async () => {
    const store = new InMemoryPrivateStore();
    const coord = new DearDumbassSyncCoordinator({
      store,
      cloudClient: sharedCloud,
    });
    const repo = new DearDumbassRepository(store, coord);
    await repo.createPost("Secret text");
    await coord.enableSync(passphrase);

    expect(coord.getKeyManager().isUnlocked()).toBe(true);

    // Lock journal
    await coord.lock();
    expect(coord.getKeyManager().isUnlocked()).toBe(false);
    expect(coord.getState().status).toBe("locked");
    expect(() => coord.getKeyManager().getMasterKey()).toThrow("journal is locked");
    expect((await repo.getPost((await repo.getFeed())[0].id))?.body).toBe("Secret text");

    // Re-initialize: remains locked until passphrase entered
    await coord.initialize();
    expect(coord.getKeyManager().isUnlocked()).toBe(false);
    expect(coord.getState().status).toBe("locked");
  });

  it("11. Does not advance the cursor or partially apply a page containing corrupt ciphertext", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    await coordB.unlockSync(passphrase);

    const first = await repoA.createPost("Valid record in atomic page");
    const second = await repoA.createPost("Record that will be corrupted");
    await coordA.triggerSync();

    const corrupt = sharedCloud.records.get(second.id);
    expect(corrupt).toBeDefined();
    corrupt!.ciphertext = `${corrupt!.ciphertext.slice(0, -2)}AA`;

    await expect(coordB.triggerPull()).rejects.toThrow("Decryption failed");
    expect(await storeB.get<DearDumbassPost>(POSTS_STORE, first.id)).toBeNull();
    expect(await storeB.get<DearDumbassPost>(POSTS_STORE, second.id)).toBeNull();
    expect(
      await storeB.get<{ id: string; lastServerSequence: number }>(
        SYNC_META_STORE,
        "cursor",
      ),
    ).toBeNull();
  });

  it("12. Refuses to overwrite an existing cloud envelope or persist the losing key", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    await coordA.enableSync(passphrase);
    const originalEnvelope = structuredClone(sharedCloud.envelope);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    await expect(coordB.enableSync("different-secure-passphrase")).rejects.toThrow(
      "already configured",
    );

    expect(sharedCloud.envelope).toEqual(originalEnvelope);
    expect(coordB.getKeyManager().isUnlocked()).toBe(false);
    expect(await storeB.getAll(LOCAL_KEYS_STORE)).toEqual([]);
    expect(coordB.getState().status).toBe("locked");
  });

  it("13. Leaves no local key or sync config when envelope upload fails", async () => {
    const store = new InMemoryPrivateStore();
    const coord = new DearDumbassSyncCoordinator({
      store,
      cloudClient: sharedCloud,
    });
    const repo = new DearDumbassRepository(store, coord);
    await repo.createPost("Must remain local only");
    sharedCloud.failNextUpload = true;

    await expect(coord.enableSync(passphrase)).rejects.toThrow(
      "Network simulated failure",
    );
    expect(coord.getKeyManager().isUnlocked()).toBe(false);
    expect(await store.getAll(LOCAL_KEYS_STORE)).toEqual([]);
    expect(await store.get(SYNC_META_STORE, "sync_config")).toBeNull();
    expect((await repo.getFeed())[0].body).toBe("Must remain local only");
  });

  it("14. Preserves equal-revision pre-existing divergence as an explicit conflict", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);
    const cloudPost = await repoA.createPost("Cloud version");
    await coordA.triggerSync();

    const storeB = new InMemoryPrivateStore();
    await storeB.put<DearDumbassPost>(POSTS_STORE, {
      ...cloudPost,
      body: "Pre-existing local version",
    });
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });

    await coordB.unlockSync(passphrase);
    const conflicts = await coordB.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].localPost.body).toBe("Pre-existing local version");
    expect(conflicts[0].remotePost.body).toBe("Cloud version");
    expect((await storeB.get<DearDumbassPost>(POSTS_STORE, cloudPost.id))?.body).toBe(
      "Pre-existing local version",
    );
  });

  it("15. Conflict resolution uploads from the remote CAS baseline and converges devices", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);
    const post = await repoA.createPost("Base");
    await coordA.triggerSync();

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);

    await repoA.updatePost(post.id, "Device A edit");
    await repoB.updatePost(post.id, "Device B chosen edit");
    await coordA.triggerSync();
    await coordB.triggerSync();
    expect((await coordB.getConflicts()).length).toBe(1);

    await coordB.resolveConflict(post.id, "local");
    await coordB.triggerSync();
    expect(sharedCloud.records.get(post.id)?.syncVersion).toBe(3);

    await coordA.triggerPull();
    expect((await repoA.getPost(post.id))?.body).toBe("Device B chosen edit");
    expect(await coordA.getConflicts()).toEqual([]);
  });

  it("16. Preserves a mutation queued while an older snapshot is being acknowledged", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    await coordA.enableSync(passphrase);
    const post = await repoA.createPost("Base");
    await coordA.triggerSync();

    sharedCloud.beforeRecordUpload = async ({ recordId }) => {
      expect(recordId).toBe(post.id);
      await repoA.updatePost(post.id, "Newest edit queued during upload");
    };

    await repoA.updatePost(post.id, "Older in-flight edit");
    await coordA.triggerSync();
    await coordA.triggerSync();
    expect(await storeA.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE)).toEqual([]);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);
    expect((await repoB.getPost(post.id))?.body).toBe(
      "Newest edit queued during upload",
    );
  });

  it("17. Pulls more than one page during bootstrap", async () => {
    const storeA = new InMemoryPrivateStore();
    const coordA = new DearDumbassSyncCoordinator({
      store: storeA,
      cloudClient: sharedCloud,
    });
    const repoA = new DearDumbassRepository(storeA, coordA);
    for (let index = 0; index < 105; index += 1) {
      await repoA.createPost(`Paginated post ${index}`);
    }
    await coordA.enableSync(passphrase);
    expect(sharedCloud.records.size).toBe(105);

    const storeB = new InMemoryPrivateStore();
    const coordB = new DearDumbassSyncCoordinator({
      store: storeB,
      cloudClient: sharedCloud,
    });
    const repoB = new DearDumbassRepository(storeB, coordB);
    await coordB.unlockSync(passphrase);
    expect(await repoB.getFeed()).toHaveLength(105);
  });
});
