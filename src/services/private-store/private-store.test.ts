import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  getPrivateStore,
  InMemoryPrivateStore,
  IndexedDbPrivateStore,
  resetDefaultPrivateStore,
} from "./index";

describe("PrivateStore Storage Layer", () => {
  beforeEach(() => {
    resetDefaultPrivateStore();
  });

  describe("InMemoryPrivateStore", () => {
    it("performs basic CRUD operations", async () => {
      const store = new InMemoryPrivateStore();
      const testItem = { id: "post-1", body: "hello world", replyToId: null };

      // Put
      await store.put("dear_dumbass_posts", testItem);

      // Get
      const retrieved = await store.get<typeof testItem>("dear_dumbass_posts", "post-1");
      expect(retrieved).toEqual(testItem);

      // Update
      const updatedItem = { ...testItem, body: "updated body" };
      await store.put("dear_dumbass_posts", updatedItem);
      const afterUpdate = await store.get<typeof testItem>("dear_dumbass_posts", "post-1");
      expect(afterUpdate?.body).toBe("updated body");

      // Delete
      await store.delete("dear_dumbass_posts", "post-1");
      const afterDelete = await store.get<typeof testItem>("dear_dumbass_posts", "post-1");
      expect(afterDelete).toBeNull();
    });

    it("handles batch operations", async () => {
      const store = new InMemoryPrivateStore();
      const items = [
        { id: "1", body: "first", replyToId: null },
        { id: "2", body: "second", replyToId: "1" },
        { id: "3", body: "third", replyToId: "1" },
      ];

      await store.putBatch("dear_dumbass_posts", items);
      const all = await store.getAll<typeof items[0]>("dear_dumbass_posts");
      expect(all).toHaveLength(3);

      await store.deleteBatch("dear_dumbass_posts", ["1", "3"]);
      const remaining = await store.getAll<typeof items[0]>("dear_dumbass_posts");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("2");
    });

    it("queries by index property correctly", async () => {
      const store = new InMemoryPrivateStore();
      const items = [
        { id: "root-1", body: "root 1", replyToId: null },
        { id: "reply-1", body: "reply to 1", replyToId: "root-1" },
        { id: "reply-2", body: "another reply to 1", replyToId: "root-1" },
        { id: "root-2", body: "root 2", replyToId: null },
      ];

      await store.putBatch("dear_dumbass_posts", items);

      const root1Replies = await store.getAllByIndex<typeof items[0]>(
        "dear_dumbass_posts",
        "by_replyToId",
        "root-1",
      );
      expect(root1Replies).toHaveLength(2);
      expect(root1Replies.map((r) => r.id)).toEqual(["reply-1", "reply-2"]);
    });

    it("clears a store without affecting other stores", async () => {
      const store = new InMemoryPrivateStore();
      await store.put("store-a", { id: "a1", val: 1 });
      await store.put("store-b", { id: "b1", val: 2 });

      await store.clear("store-a");
      expect(await store.getAll("store-a")).toHaveLength(0);
      expect(await store.getAll("store-b")).toHaveLength(1);
    });

    it("rolls back a failed read-write transaction", async () => {
      const store = new InMemoryPrivateStore();

      await expect(
        store.transaction("dear_dumbass_posts", "readwrite", async (transaction) => {
          await transaction.put("dear_dumbass_posts", {
            id: "rolled-back",
            body: "must not commit",
          });
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");

      expect(await store.get("dear_dumbass_posts", "rolled-back")).toBeNull();
    });
  });

  describe("getPrivateStore client-only guard", () => {
    it("throws a clear error when invoked outside a browser environment without customStore", () => {
      expect(() => getPrivateStore()).toThrowError(
        "PrivateStore is client-only and requires a browser environment with IndexedDB",
      );
    });

    it("allows supplying an explicit custom PrivateStore instance (for testing/DI)", () => {
      const customStore = new InMemoryPrivateStore();
      const store = getPrivateStore(customStore);
      expect(store).toBe(customStore);
    });

    it("returns IndexedDbPrivateStore when browser globals window and indexedDB exist", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("indexedDB", indexedDB);

      try {
        const store = getPrivateStore();
        expect(store).toBeInstanceOf(IndexedDbPrivateStore);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("IndexedDbPrivateStore with real IndexedDB (fake-indexeddb)", () => {
    let testDbName: string;
    let store: IndexedDbPrivateStore;

    beforeEach(() => {
      vi.stubGlobal("indexedDB", indexedDB);
      testDbName = `test-private-db-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      store = new IndexedDbPrivateStore(testDbName, 1);
    });

    afterEach(() => {
      store.close();
      vi.unstubAllGlobals();
    });

    it("initializes schema with dear_dumbass_posts store and by_replyToId index", async () => {
      const item = {
        id: "post-1",
        body: "Test body in real IDB",
        replyToId: null,
      };

      await store.put("dear_dumbass_posts", item);
      const fetched = await store.get<typeof item>("dear_dumbass_posts", "post-1");
      expect(fetched).toEqual(item);
    });

    it("fails closed when a requested schema version has no migration", async () => {
      const unsupportedStore = new IndexedDbPrivateStore(
        `${testDbName}-unsupported-version`,
        2,
      );

      await expect(
        unsupportedStore.get("dear_dumbass_posts", "post-1"),
      ).rejects.toBeTruthy();
      unsupportedStore.close();
    });

    it("performs put, get, getAll, and delete on IndexedDB", async () => {
      const item1 = { id: "p-1", body: "Hello", replyToId: null };
      const item2 = { id: "p-2", body: "World", replyToId: null };

      await store.put("dear_dumbass_posts", item1);
      await store.put("dear_dumbass_posts", item2);

      const all = await store.getAll<typeof item1>("dear_dumbass_posts");
      expect(all).toHaveLength(2);

      await store.delete("dear_dumbass_posts", "p-1");
      const remaining = await store.getAll<typeof item1>("dear_dumbass_posts");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("p-2");
    });

    it("queries by_replyToId index in real IndexedDB", async () => {
      const root = { id: "root-1", body: "Root", replyToId: null };
      const reply1 = { id: "rep-1", body: "Reply 1", replyToId: "root-1" };
      const reply2 = { id: "rep-2", body: "Reply 2", replyToId: "root-1" };
      const otherRoot = { id: "root-2", body: "Other root", replyToId: null };

      await store.putBatch("dear_dumbass_posts", [root, reply1, reply2, otherRoot]);

      const replies = await store.getAllByIndex<typeof reply1>(
        "dear_dumbass_posts",
        "by_replyToId",
        "root-1",
      );
      expect(replies).toHaveLength(2);
      expect(replies.map((r) => r.id).sort()).toEqual(["rep-1", "rep-2"]);
    });

    it("performs batch put and batch delete in IndexedDB", async () => {
      const items = [
        { id: "b-1", body: "Batch 1", replyToId: null },
        { id: "b-2", body: "Batch 2", replyToId: null },
        { id: "b-3", body: "Batch 3", replyToId: null },
      ];

      await store.putBatch("dear_dumbass_posts", items);
      expect(await store.getAll("dear_dumbass_posts")).toHaveLength(3);

      await store.deleteBatch("dear_dumbass_posts", ["b-1", "b-3"]);
      const remaining = await store.getAll<typeof items[0]>("dear_dumbass_posts");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("b-2");
    });

    it("clears the store in IndexedDB", async () => {
      await store.put("dear_dumbass_posts", { id: "c-1", body: "Clear me", replyToId: null });
      expect(await store.getAll("dear_dumbass_posts")).toHaveLength(1);

      await store.clear("dear_dumbass_posts");
      expect(await store.getAll("dear_dumbass_posts")).toHaveLength(0);
    });

    it("rolls back a failed IndexedDB read-write transaction", async () => {
      await expect(
        store.transaction("dear_dumbass_posts", "readwrite", async (transaction) => {
          await transaction.put("dear_dumbass_posts", {
            id: "rolled-back",
            body: "must not commit",
            replyToId: null,
          });
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");

      expect(await store.get("dear_dumbass_posts", "rolled-back")).toBeNull();
    });
  });
});
