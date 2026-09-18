import { beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryPrivateStore,
  type PrivateStore,
  type PrivateStoreTransaction,
} from "@/services/private-store";
import {
  createEncryptedBackup,
  decryptBackupArchive,
  validateArchivePayload,
  type DearDumbassArchivePayload,
} from "./backup";
import { DearDumbassRepository } from "./dear-dumbass-repository";
import type { DearDumbassPost } from "./types";

describe("Dear Dumbass Encrypted Backup & Restore", () => {
  let store: InMemoryPrivateStore;
  let repo: DearDumbassRepository;

  const samplePosts: DearDumbassPost[] = [
    {
      id: "post-1",
      body: "First thought",
      createdAt: "2026-09-18T10:00:00.000Z",
      updatedAt: null,
      revision: 0,
      replyToId: null,
      deletedAt: null,
    },
    {
      id: "reply-1",
      body: "Reply to first thought",
      createdAt: "2026-09-18T10:01:00.000Z",
      updatedAt: null,
      revision: 0,
      replyToId: "post-1",
      deletedAt: null,
    },
    {
      id: "tombstone-1",
      body: "",
      createdAt: "2026-09-18T09:00:00.000Z",
      updatedAt: null,
      revision: 1,
      replyToId: null,
      deletedAt: "2026-09-18T09:30:00.000Z",
    },
  ];

  beforeEach(() => {
    store = new InMemoryPrivateStore();
    repo = new DearDumbassRepository(store);
  });

  describe("Web Crypto Encryption and Decryption", () => {
    it("1. performs encrypted export -> decrypt round trip with correct passphrase", async () => {
      const passphrase = "correct horse battery staple 42!";
      const envelope = await createEncryptedBackup(samplePosts, passphrase);

      // Verify envelope structure (does NOT contain plaintext or passphrase)
      expect(envelope.app).toBe("redline");
      expect(envelope.format).toBe("dear-dumbass-encrypted-backup");
      expect(envelope.version).toBe(1);
      expect(envelope.kdf.algorithm).toBe("PBKDF2");
      expect(envelope.kdf.hash).toBe("SHA-256");
      expect(envelope.cipher.algorithm).toBe("AES-GCM");
      expect(envelope.cipher.iv).toBeTruthy();
      expect(envelope.ciphertext).toBeTruthy();

      const envelopeString = JSON.stringify(envelope);
      expect(envelopeString).not.toContain("First thought");
      expect(envelopeString).not.toContain("Reply to first thought");
      expect(envelopeString).not.toContain(passphrase);

      // Decrypt with correct passphrase
      const decrypted = await decryptBackupArchive(envelope, passphrase);
      expect(decrypted.format).toBe("dear-dumbass-archive");
      expect(decrypted.version).toBe(1);
      expect(decrypted.posts).toHaveLength(3);
      expect(decrypted.posts.find((p) => p.id === "post-1")?.body).toBe(
        "First thought",
      );
    });

    it("2. cleanly rejects wrong passphrase without leaking sensitive crypto internals", async () => {
      const passphrase = "correct-password";
      const envelope = await createEncryptedBackup(samplePosts, passphrase);

      await expect(
        decryptBackupArchive(envelope, "wrong-password"),
      ).rejects.toThrow("Incorrect passphrase or corrupted backup file.");
    });

    it("3. rejects malformed backup envelopes", async () => {
      await expect(
        decryptBackupArchive("not-an-object", "pass"),
      ).rejects.toThrow("Malformed or invalid backup envelope.");

      await expect(
        decryptBackupArchive({ app: "other", format: "wrong" }, "pass"),
      ).rejects.toThrow("Malformed or invalid backup envelope.");
    });

    it("4. rejects unsupported backup versions", async () => {
      const envelope = await createEncryptedBackup(samplePosts, "secret");
      const unsupported = { ...envelope, version: 99 };

      await expect(
        decryptBackupArchive(unsupported, "secret"),
      ).rejects.toThrow("Unsupported backup format version: 99.");
    });

    it("5. validates schema and rejects malformed post records before writes", () => {
      const invalidPayload = {
        format: "dear-dumbass-archive",
        version: 1,
        posts: [
          {
            id: "", // Invalid empty ID
            body: "Post with empty id",
            createdAt: "2026-09-18T10:00:00Z",
          },
        ],
      };

      expect(() => validateArchivePayload(invalidPayload)).toThrow(
        "Invalid backup: post id must be a non-empty string.",
      );

      const badDatePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        posts: [
          {
            id: "valid-id",
            body: "Content",
            createdAt: "not-a-date",
          },
        ],
      };

      expect(() => validateArchivePayload(badDatePayload)).toThrow(
        "Invalid backup: post createdAt must be a valid ISO date string.",
      );
    });

    it("6. ensures deleted/tombstoned records remain scrubbed (body === '') after backup & restore", async () => {
      const postsWithUnscrubbedDeleted: DearDumbassPost[] = [
        {
          id: "deleted-with-leak",
          body: "Sensitive data that should be scrubbed",
          createdAt: "2026-09-18T10:00:00.000Z",
          updatedAt: null,
          revision: 1,
          replyToId: null,
          deletedAt: "2026-09-18T10:05:00.000Z",
        },
      ];

      const envelope = await createEncryptedBackup(
        postsWithUnscrubbedDeleted,
        "pass",
      );
      const decrypted = await decryptBackupArchive(envelope, "pass");

      // Invariant: Tombstone post in backup archive MUST have body scrubbed to empty string
      const scrubbed = decrypted.posts.find((p) => p.id === "deleted-with-leak");
      expect(scrubbed?.body).toBe("");
      expect(scrubbed?.deletedAt).toBe("2026-09-18T10:05:00.000Z");
    });
  });

  describe("Repository Restore Operations (Merge vs Replace)", () => {
    it("7. Merge mode inserts new records and preserves existing local data", async () => {
      // Seed local store
      const localPost = await repo.createPost("Local original thought");

      const incomingPayload: DearDumbassArchivePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        posts: [
          {
            id: "incoming-post-1",
            body: "Incoming from another device/backup",
            createdAt: "2026-09-18T11:00:00.000Z",
            updatedAt: null,
            revision: 0,
            replyToId: null,
            deletedAt: null,
          },
        ],
      };

      const result = await repo.restoreArchive(incomingPayload, "merge");
      expect(result.mode).toBe("merge");
      expect(result.restoredCount).toBe(1);

      // Local original post is still present!
      const fetchedLocal = await repo.getPost(localPost.id);
      expect(fetchedLocal?.body).toBe("Local original thought");

      // Incoming post is also present
      const fetchedIncoming = await repo.getPost("incoming-post-1");
      expect(fetchedIncoming?.body).toBe("Incoming from another device/backup");
    });

    it("8. Merge mode does NOT resurrect locally deleted & tombstoned posts", async () => {
      // Create local post and delete it (tombstoned)
      const post = await repo.createPost("Confidential vent");
      await repo.deletePost(post.id);

      // Verify it's deleted locally
      expect(await repo.getPost(post.id)).toBeNull();

      // Incoming backup contains an older active version of the same post ID
      const incomingPayload: DearDumbassArchivePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        posts: [
          {
            id: post.id,
            body: "Confidential vent (old active snapshot)",
            createdAt: post.createdAt,
            updatedAt: null,
            revision: 0,
            replyToId: null,
            deletedAt: null,
          },
        ],
      };

      const result = await repo.restoreArchive(incomingPayload, "merge");
      expect(result.preservedCount).toBe(1);

      // Post remains deleted locally!
      expect(await repo.getPost(post.id)).toBeNull();

      // Raw record body in IndexedDB remains empty string
      const raw = await store.get<DearDumbassPost>("dear_dumbass_posts", post.id);
      expect(raw?.body).toBe("");
      expect(raw?.deletedAt).toBeTruthy();
    });

    it("9. Merge mode applies incoming deletion tombstones to active local posts", async () => {
      const activePost = await repo.createPost("Active locally");

      const incomingPayload: DearDumbassArchivePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        posts: [
          {
            id: activePost.id,
            body: "",
            createdAt: activePost.createdAt,
            updatedAt: null,
            revision: 2,
            replyToId: null,
            deletedAt: "2026-09-18T12:00:00.000Z",
          },
        ],
      };

      const result = await repo.restoreArchive(incomingPayload, "merge");
      expect(result.updatedCount).toBe(1);

      // Post is now deleted locally
      expect(await repo.getPost(activePost.id)).toBeNull();
    });

    it("10. Replace mode completely replaces the local archive atomically", async () => {
      // Seed 2 local posts
      await repo.createPost("Local post 1");
      await repo.createPost("Local post 2");

      const incomingPayload: DearDumbassArchivePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        posts: [
          {
            id: "replacement-post-1",
            body: "Only this post should survive",
            createdAt: "2026-09-18T12:00:00.000Z",
            updatedAt: null,
            revision: 0,
            replyToId: null,
            deletedAt: null,
          },
        ],
      };

      const result = await repo.restoreArchive(incomingPayload, "replace");
      expect(result.mode).toBe("replace");
      expect(result.restoredCount).toBe(1);

      const feed = await repo.getFeed();
      expect(feed).toHaveLength(1);
      expect(feed[0].id).toBe("replacement-post-1");
      expect(feed[0].body).toBe("Only this post should survive");
    });

    it("11. validation failure leaves database completely untouched", async () => {
      const localPost = await repo.createPost("Untouched local post");

      const invalidPayload = {
        format: "dear-dumbass-archive",
        version: 1,
        posts: [
          {
            id: "bad-id",
            body: 12345, // Invalid body type
            createdAt: "2026-09-18T10:00:00Z",
          },
        ],
      } as unknown as DearDumbassArchivePayload;

      await expect(repo.restoreArchive(invalidPayload, "replace")).rejects.toThrow(
        "Invalid backup: post body must be a string.",
      );

      // Verify local database was NOT cleared and localPost remains intact
      const feed = await repo.getFeed();
      expect(feed).toHaveLength(1);
      expect(feed[0].id).toBe(localPost.id);
    });

    it("12. transactional rollback on failure leaves database in original state", async () => {
      let shouldFail = false;
      const wrappedStore = new InMemoryPrivateStore();
      const customStore: PrivateStore = {
        get: wrappedStore.get.bind(wrappedStore),
        getAll: wrappedStore.getAll.bind(wrappedStore),
        getAllByIndex: wrappedStore.getAllByIndex.bind(wrappedStore),
        put: wrappedStore.put.bind(wrappedStore),
        putBatch: wrappedStore.putBatch.bind(wrappedStore),
        delete: wrappedStore.delete.bind(wrappedStore),
        deleteBatch: wrappedStore.deleteBatch.bind(wrappedStore),
        clear: wrappedStore.clear.bind(wrappedStore),
        close: wrappedStore.close.bind(wrappedStore),
        transaction: async <R>(
          storeNames: string | readonly string[],
          mode: "readonly" | "readwrite",
          operation: (transaction: PrivateStoreTransaction) => Promise<R> | R,
        ): Promise<R> => {
          return wrappedStore.transaction(storeNames, mode, (tx) => {
            const wrappedTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === "putBatch") {
                  return async <T extends { id: string }>(
                    storeName: string,
                    values: T[],
                  ) => {
                    if (shouldFail) {
                      throw new Error("Disk IO failure simulated");
                    }
                    return target.putBatch(storeName, values);
                  };
                }
                const val = Reflect.get(target, prop, receiver);
                return typeof val === "function" ? val.bind(target) : val;
              },
            });
            return operation(wrappedTx);
          });
        },
      };

      const customRepo = new DearDumbassRepository(customStore);
      const localPost = await customRepo.createPost(
        "Existing post in custom store",
      );

      const incomingPayload: DearDumbassArchivePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        posts: [
          {
            id: "new-p1",
            body: "Will fail",
            createdAt: "2026-09-18T10:00:00Z",
            updatedAt: null,
            revision: 0,
            replyToId: null,
            deletedAt: null,
          },
        ],
      };

      shouldFail = true;
      await expect(
        customRepo.restoreArchive(incomingPayload, "replace"),
      ).rejects.toThrow("Disk IO failure simulated");

      // Verify that after failure, original post remains completely intact
      shouldFail = false;
      const feed = await customRepo.getFeed();
      expect(feed).toHaveLength(1);
      expect(feed[0].id).toBe(localPost.id);
      expect(feed[0].body).toBe("Existing post in custom store");
    });
  });
});
