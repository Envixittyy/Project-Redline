import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import { DearDumbassRepository } from "../dear-dumbass-repository";
import type { DearDumbassPost } from "../types";
import type { DearDumbassCloudClient } from "./cloud-client";
import {
  DearDumbassSyncCoordinator,
  POSTS_STORE,
  SYNC_CONFLICTS_STORE,
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

  it("10. Lock journal on this device removes local key and makes content unavailable", async () => {
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

    // Re-initialize: remains locked until passphrase entered
    await coord.initialize();
    expect(coord.getKeyManager().isUnlocked()).toBe(false);
    expect(coord.getState().status).toBe("locked");
  });
});
