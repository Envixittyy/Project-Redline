import { beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryPrivateStore,
  type PrivateStore,
  type PrivateStoreTransaction,
} from "@/services/private-store";
import {
  base64ToBytes,
  createEncryptedBackup,
  decryptBackupArchive,
  IV_BYTE_LENGTH,
  PBKDF2_ITERATIONS,
  SALT_BYTE_LENGTH,
  validateArchivePayload,
  type DearDumbassArchivePayload,
} from "./backup";
import { DearDumbassRepository } from "./dear-dumbass-repository";
import {
  POSTS_STORE,
  SYNC_CONFLICTS_STORE,
  SYNC_META_STORE,
  SYNC_OUTBOX_STORE,
} from "./sync/sync-coordinator";
import type {
  DearDumbassOutboxItem,
  DearDumbassSyncConflict,
} from "./sync/types";
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
      expect(envelope.kdf.iterations).toBe(PBKDF2_ITERATIONS);
      expect(base64ToBytes(envelope.kdf.salt)).toHaveLength(SALT_BYTE_LENGTH);
      expect(envelope.cipher.algorithm).toBe("AES-GCM");
      expect(base64ToBytes(envelope.cipher.iv)).toHaveLength(IV_BYTE_LENGTH);
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
        "Invalid backup: post id must be a bounded, non-empty ID.",
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
        "Invalid backup: post createdAt must be an ISO timestamp.",
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

    it("rejects unsafe cryptographic parameters before key derivation", async () => {
      const envelope = await createEncryptedBackup(samplePosts, "secret");

      await expect(
        decryptBackupArchive(
          { ...envelope, kdf: { ...envelope.kdf, iterations: 99_999 } },
          "secret",
        ),
      ).rejects.toThrow("Unsupported or invalid key derivation parameters.");

      await expect(
        decryptBackupArchive(
          { ...envelope, cipher: { ...envelope.cipher, tagLength: 64 } },
          "secret",
        ),
      ).rejects.toThrow("Unsupported cipher algorithm.");

      await expect(
        decryptBackupArchive(
          { ...envelope, kdf: { ...envelope.kdf, salt: "AA==" } },
          "secret",
        ),
      ).rejects.toThrow("Unsupported or invalid cryptographic parameters.");
    });

    it("uses fresh random salt and IV for every backup", async () => {
      const first = await createEncryptedBackup(samplePosts, "secret");
      const second = await createEncryptedBackup(samplePosts, "secret");

      expect(first.kdf.salt).not.toBe(second.kdf.salt);
      expect(first.cipher.iv).not.toBe(second.cipher.iv);
      expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it("treats passphrase whitespace as significant", async () => {
      const envelope = await createEncryptedBackup(samplePosts, "  secret  ");

      await expect(
        decryptBackupArchive(envelope, "  secret  "),
      ).resolves.toMatchObject({ format: "dear-dumbass-archive" });
      await expect(decryptBackupArchive(envelope, "secret")).rejects.toThrow(
        "Incorrect passphrase or corrupted backup file.",
      );
    });

    it("validates unique IDs and complete root/reply relationships", () => {
      const root = samplePosts[0];
      const reply = samplePosts[1];
      const payload = (posts: DearDumbassPost[]) => ({
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: "2026-09-18T12:00:00.000Z",
        posts,
      });

      expect(() => validateArchivePayload(payload([root, root]))).toThrow(
        "Invalid backup: post IDs must be unique.",
      );
      expect(() => validateArchivePayload(payload([reply]))).toThrow(
        "Invalid backup: every reply must reference an archived root post.",
      );
      expect(() =>
        validateArchivePayload(
          payload([
            root,
            reply,
            { ...reply, id: "nested", replyToId: reply.id },
          ]),
        ),
      ).toThrow("Invalid backup: nested replies are not supported.");
      expect(() =>
        validateArchivePayload(
          payload([
            { ...root, body: "", deletedAt: "2026-09-18T11:00:00.000Z" },
            reply,
          ]),
        ),
      ).toThrow(
        "Invalid backup: active replies cannot belong to a deleted root post.",
      );
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

    it("replace mode under sync turns omitted records into queued tombstones", async () => {
      const omitted = await repo.createPost("Must not resurrect from cloud");
      await store.put(SYNC_META_STORE, {
        id: "sync_config",
        enabled: true,
        enabledAt: "2026-09-18T12:00:00.000Z",
        ownerId: "user-test-123",
      });
      await store.put<DearDumbassSyncConflict>(SYNC_CONFLICTS_STORE, {
        id: omitted.id,
        localPost: omitted,
        remotePost: { ...omitted, body: "Remote alternate" },
        remoteSyncVersion: 1,
        remoteServerChangeSequence: 1,
        detectedAt: "2026-09-18T12:00:00.000Z",
      });

      await repo.restoreArchive(
        {
          format: "dear-dumbass-archive",
          version: 1,
          exportedAt: "2026-09-18T12:00:00.000Z",
          posts: [
            {
              id: "replacement-post",
              body: "Replacement",
              createdAt: "2026-09-18T12:00:00.000Z",
              updatedAt: null,
              revision: 0,
              replyToId: null,
              deletedAt: null,
            },
          ],
        },
        "replace",
      );

      const tombstone = await store.get<DearDumbassPost>(POSTS_STORE, omitted.id);
      expect(tombstone?.body).toBe("");
      expect(tombstone?.deletedAt).toBeTruthy();
      expect(await store.get(SYNC_CONFLICTS_STORE, omitted.id)).toBeNull();
      const outbox = await store.getAll<DearDumbassOutboxItem>(SYNC_OUTBOX_STORE);
      expect(outbox.map((item) => item.recordId).sort()).toEqual(
        [omitted.id, "replacement-post"].sort(),
      );
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

    it("merge applies an imported root tombstone to every local reply", async () => {
      const root = await repo.createPost("Root secret");
      const reply = await repo.createPost("Reply secret", root.id);
      const payload: DearDumbassArchivePayload = {
        format: "dear-dumbass-archive",
        version: 1,
        exportedAt: "2026-09-18T12:00:00.000Z",
        posts: [
          {
            ...root,
            body: "",
            deletedAt: "2026-09-18T12:00:00.000Z",
          },
        ],
      };

      await repo.restoreArchive(payload, "merge");

      const rawReply = await store.get<DearDumbassPost>(
        "dear_dumbass_posts",
        reply.id,
      );
      expect(rawReply?.body).toBe("");
      expect(rawReply?.deletedAt).toBe("2026-09-18T12:00:00.000Z");
    });

    it("merge gives tombstones precedence over higher live revisions", async () => {
      const post = await repo.createPost("Local");
      await repo.updatePost(post.id, "Local revision one", 0);
      await repo.updatePost(post.id, "Local revision two", 1);

      await repo.restoreArchive(
        {
          format: "dear-dumbass-archive",
          version: 1,
          exportedAt: "2026-09-18T12:00:00.000Z",
          posts: [
            {
              ...post,
              body: "",
              revision: 0,
              deletedAt: "2026-09-18T12:00:00.000Z",
            },
          ],
        },
        "merge",
      );

      expect(await repo.getPost(post.id)).toBeNull();
    });

    it("merge ignores clock-skewed timestamps when revisions are equal", async () => {
      const post = await repo.createPost("Original");
      const edited = await repo.updatePost(post.id, "Local edit", 0);

      await repo.restoreArchive(
        {
          format: "dear-dumbass-archive",
          version: 1,
          exportedAt: "2026-09-18T12:00:00.000Z",
          posts: [
            {
              ...edited,
              body: "Clock-skewed competing edit",
              updatedAt: "2099-01-01T00:00:00.000Z",
            },
          ],
        },
        "merge",
      );

      expect((await repo.getPost(post.id))?.body).toBe("Local edit");
    });

    it("merge scrubs a new imported reply when the local root is tombstoned", async () => {
      const root = await repo.createPost("Deleted locally");
      await repo.deletePost(root.id);

      await repo.restoreArchive(
        {
          format: "dear-dumbass-archive",
          version: 1,
          exportedAt: "2026-09-18T12:00:00.000Z",
          posts: [
            root,
            {
              id: "new-reply",
              body: "Must not survive",
              createdAt: "2026-09-18T11:00:00.000Z",
              updatedAt: null,
              revision: 0,
              replyToId: root.id,
              deletedAt: null,
            },
          ],
        },
        "merge",
      );

      const rawReply = await store.get<DearDumbassPost>(
        "dear_dumbass_posts",
        "new-reply",
      );
      expect(rawReply?.body).toBe("");
      expect(rawReply?.deletedAt).toBeTruthy();
    });

    it("rejects immutable identity conflicts without changing local data", async () => {
      const local = await repo.createPost("Keep me");

      await expect(
        repo.restoreArchive(
          {
            format: "dear-dumbass-archive",
            version: 1,
            exportedAt: "2026-09-18T12:00:00.000Z",
            posts: [
              {
                ...local,
                createdAt: "2020-01-01T00:00:00.000Z",
                revision: 99,
              },
            ],
          },
          "merge",
        ),
      ).rejects.toThrow(
        "Backup conflicts with immutable post identity or parent relationship.",
      );
      expect((await repo.getPost(local.id))?.body).toBe("Keep me");
    });
  });
});
