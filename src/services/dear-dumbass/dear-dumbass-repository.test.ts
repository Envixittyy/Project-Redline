import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryPrivateStore } from "@/services/private-store";
import { DearDumbassRepository } from "./dear-dumbass-repository";

describe("DearDumbassRepository", () => {
  let store: InMemoryPrivateStore;
  let repo: DearDumbassRepository;

  beforeEach(() => {
    store = new InMemoryPrivateStore();
    repo = new DearDumbassRepository(store);
  });

  afterEach(() => {
    repo.close();
  });

  it("1. creates a root post and stores it", async () => {
    const post = await repo.createPost("FUCK THIS CLASS");

    expect(post.id).toBeTruthy();
    expect(post.body).toBe("FUCK THIS CLASS");
    expect(post.replyToId).toBeNull();
    expect(post.updatedAt).toBeNull();
    expect(post.deletedAt).toBeNull();
    expect(new Date(post.createdAt).getTime()).not.toBeNaN();

    const fetched = await repo.getPost(post.id);
    expect(fetched).toEqual(post);
  });

  it("2. retrieves root posts in reverse chronological order (newest first)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
      const post1 = await repo.createPost("First thought");

      vi.setSystemTime(new Date("2026-09-18T10:05:00Z"));
      const post2 = await repo.createPost("Second thought");

      vi.setSystemTime(new Date("2026-09-18T10:10:00Z"));
      const post3 = await repo.createPost("Third thought");

      const feed = await repo.getFeed();
      expect(feed.map((p) => p.id)).toEqual([post3.id, post2.id, post1.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("3. creates a reply to an existing post", async () => {
    const root = await repo.createPost("Root post");
    const reply = await repo.createPost("Replying to myself", root.id);

    expect(reply.id).toBeTruthy();
    expect(reply.replyToId).toBe(root.id);
    expect(reply.body).toBe("Replying to myself");

    // Reply does NOT appear in root feed
    const feed = await repo.getFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0].id).toBe(root.id);
  });

  it("4. retrieves thread replies in chronological order (oldest to newest)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
      const root = await repo.createPost("Question: why am I like this?");

      vi.setSystemTime(new Date("2026-09-18T10:01:00Z"));
      const reply1 = await repo.createPost("Reply 1: because you procrastinate", root.id);

      vi.setSystemTime(new Date("2026-09-18T10:02:00Z"));
      const reply2 = await repo.createPost("Reply 2: also lack of sleep", root.id);

      const replies = await repo.getReplies(root.id);
      expect(replies.map((r) => r.id)).toEqual([reply1.id, reply2.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("5. edits a post, preserving createdAt and setting updatedAt", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
      const post = await repo.createPost("Typo in this psot");

      vi.setSystemTime(new Date("2026-09-18T10:05:00Z"));
      const updated = await repo.updatePost(post.id, "Typo in this post [fixed]");

      expect(updated.id).toBe(post.id);
      expect(updated.body).toBe("Typo in this post [fixed]");
      expect(updated.createdAt).toBe("2026-09-18T10:00:00.000Z");
      expect(updated.updatedAt).toBe("2026-09-18T10:05:00.000Z");
      expect(updated.revision).toBe(1);

      const fetched = await repo.getPost(post.id);
      expect(fetched?.body).toBe("Typo in this post [fixed]");
      expect(fetched?.updatedAt).toBe("2026-09-18T10:05:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a stale edit revision without discarding the newer body", async () => {
    const post = await repo.createPost("Original");
    await repo.updatePost(post.id, "Newer edit", 0);

    await expect(repo.updatePost(post.id, "Stale edit", 0)).rejects.toThrow(
      "Post changed after editing began.",
    );
    expect((await repo.getPost(post.id))?.body).toBe("Newer edit");
  });

  it("6. deletes a reply without deleting the parent post", async () => {
    const root = await repo.createPost("Root post");
    const reply1 = await repo.createPost("Reply 1", root.id);
    const reply2 = await repo.createPost("Reply 2", root.id);

    await repo.deletePost(reply1.id);

    const activeReplies = await repo.getReplies(root.id);
    expect(activeReplies.map((r) => r.id)).toEqual([reply2.id]);

    const deletedReply = await repo.getPost(reply1.id);
    expect(deletedReply).toBeNull();

    // Verify tombstone in raw store has body scrubbed to empty string
    const rawTombstone = await store.get<{ id: string; body: string; deletedAt: string }>(
      "dear_dumbass_posts",
      reply1.id,
    );
    expect(rawTombstone?.body).toBe("");
    expect(rawTombstone?.deletedAt).toBeTruthy();

    const rootPost = await repo.getPost(root.id);
    expect(rootPost).not.toBeNull();
  });

  it("7. deletes a root post and cascades deletion to all child replies with plaintext scrubbed", async () => {
    const root = await repo.createPost("Root with replies");
    const reply1 = await repo.createPost("Reply 1", root.id);
    const reply2 = await repo.createPost("Reply 2", root.id);

    await repo.deletePost(root.id);

    // Root is gone from feed
    const feed = await repo.getFeed();
    expect(feed.find((p) => p.id === root.id)).toBeUndefined();

    // Replies are gone from thread
    const replies = await repo.getReplies(root.id);
    expect(replies).toHaveLength(0);

    // Direct lookups return null
    expect(await repo.getPost(root.id)).toBeNull();
    expect(await repo.getPost(reply1.id)).toBeNull();
    expect(await repo.getPost(reply2.id)).toBeNull();

    // Verify all tombstones in raw store have plaintext scrubbed to empty string
    const rawRoot = await store.get<{ id: string; body: string; deletedAt: string }>(
      "dear_dumbass_posts",
      root.id,
    );
    expect(rawRoot?.body).toBe("");
    expect(rawRoot?.deletedAt).toBeTruthy();

    const rawReply1 = await store.get<{ id: string; body: string; deletedAt: string }>(
      "dear_dumbass_posts",
      reply1.id,
    );
    expect(rawReply1?.body).toBe("");

    const rawReply2 = await store.get<{ id: string; body: string; deletedAt: string }>(
      "dear_dumbass_posts",
      reply2.id,
    );
    expect(rawReply2?.body).toBe("");
  });

  it("8. persistence survives repository reinitialization / reload equivalent", async () => {
    const post = await repo.createPost("Survives restart");
    await repo.createPost("Reply survives too", post.id);

    // Simulate page reload by creating a brand new repository instance with the same underlying store
    const newRepoInstance = new DearDumbassRepository(store);

    const feed = await newRepoInstance.getFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0].body).toBe("Survives restart");

    const replies = await newRepoInstance.getReplies(post.id);
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toBe("Reply survives too");
  });

  it("9. rejects empty or whitespace-only posts and updates", async () => {
    await expect(repo.createPost("")).rejects.toThrow("Post body cannot be blank.");
    await expect(repo.createPost("   \n\t  ")).rejects.toThrow("Post body cannot be blank.");

    const post = await repo.createPost("Valid");
    await expect(repo.updatePost(post.id, "   ")).rejects.toThrow("Post body cannot be blank.");
  });

  it("10. rejects replying to a nonexistent or deleted post", async () => {
    await expect(repo.createPost("Reply to nowhere", "nonexistent-id")).rejects.toThrow(
      "Cannot reply to a post that does not exist or has been deleted.",
    );

    const post = await repo.createPost("To be deleted");
    await repo.deletePost(post.id);

    await expect(repo.createPost("Reply to deleted", post.id)).rejects.toThrow(
      "Cannot reply to a post that does not exist or has been deleted.",
    );
  });

  it("rejects reply-to-reply relationships that the thread API cannot represent", async () => {
    const root = await repo.createPost("Root");
    const reply = await repo.createPost("Reply", root.id);

    await expect(repo.createPost("Nested reply", reply.id)).rejects.toThrow(
      "Replies must belong to a root post.",
    );
  });

  it("atomically prevents concurrent edits from restoring deleted plaintext", async () => {
    const secondRepo = new DearDumbassRepository(store);
    const root = await repo.createPost("Sensitive plaintext");

    await Promise.allSettled([
      repo.updatePost(root.id, "Concurrent edit"),
      secondRepo.deletePost(root.id),
    ]);

    const raw = await store.get<{ body: string; deletedAt: string | null }>(
      "dear_dumbass_posts",
      root.id,
    );
    expect(raw?.deletedAt).toBeTruthy();
    expect(raw?.body).toBe("");
    expect(await repo.getPost(root.id)).toBeNull();
  });

  it("atomically prevents a concurrent reply from surviving root deletion", async () => {
    const secondRepo = new DearDumbassRepository(store);
    const root = await repo.createPost("Root to delete");

    await Promise.allSettled([
      repo.createPost("Concurrent reply", root.id),
      secondRepo.deletePost(root.id),
    ]);

    expect(await repo.getReplies(root.id)).toEqual([]);
    const rawRecords = await store.getAll<{
      body: string;
      deletedAt: string | null;
      replyToId: string | null;
    }>("dear_dumbass_posts");
    const survivingReply = rawRecords.find(
      (record) => record.replyToId === root.id && !record.deletedAt,
    );
    expect(survivingReply).toBeUndefined();
    expect(
      rawRecords
        .filter((record) => record.replyToId === root.id)
        .every((record) => record.body === ""),
    ).toBe(true);
  });

  it("11. calculates reply counts correctly", async () => {
    const root1 = await repo.createPost("Root 1");
    const root2 = await repo.createPost("Root 2");

    await repo.createPost("Reply 1a", root1.id);
    await repo.createPost("Reply 1b", root1.id);
    const reply1c = await repo.createPost("Reply 1c", root1.id);

    await repo.createPost("Reply 2a", root2.id);

    let counts = await repo.getReplyCounts();
    expect(counts[root1.id]).toBe(3);
    expect(counts[root2.id]).toBe(1);

    // Delete one reply
    await repo.deletePost(reply1c.id);
    counts = await repo.getReplyCounts();
    expect(counts[root1.id]).toBe(2);
    expect(counts[root2.id]).toBe(1);
  });

  it("12. notifies subscribers on create, update, and delete", async () => {
    const listener = vi.fn();
    const unsubscribe = repo.subscribe(listener);

    const post = await repo.createPost("First");
    expect(listener).toHaveBeenCalledTimes(1);

    await repo.updatePost(post.id, "Updated");
    expect(listener).toHaveBeenCalledTimes(2);

    await repo.deletePost(post.id);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await repo.createPost("After unsubscribe");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("13. integrates with real IndexedDbPrivateStore using fake-indexeddb", async () => {
    const { IndexedDbPrivateStore } = await import("@/services/private-store");
    const { indexedDB } = await import("fake-indexeddb");
    vi.stubGlobal("indexedDB", indexedDB);

    try {
      const idbStore = new IndexedDbPrivateStore(
        `test-repo-idb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        1,
      );
      const idbRepo = new DearDumbassRepository(idbStore);

      const root = await idbRepo.createPost("Post in real IndexedDB");
      await idbRepo.createPost("Reply in real IndexedDB", root.id);

      const feed = await idbRepo.getFeed();
      expect(feed).toHaveLength(1);
      expect(feed[0].body).toBe("Post in real IndexedDB");

      const replies = await idbRepo.getReplies(root.id);
      expect(replies).toHaveLength(1);
      expect(replies[0].body).toBe("Reply in real IndexedDB");

      await idbRepo.updatePost(root.id, "Updated in real IndexedDB");
      const updated = await idbRepo.getPost(root.id);
      expect(updated?.body).toBe("Updated in real IndexedDB");

      await idbRepo.deletePost(root.id);
      expect(await idbRepo.getFeed()).toHaveLength(0);
      expect(await idbRepo.getReplies(root.id)).toHaveLength(0);

      idbStore.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("Local search", () => {
    it("searches root posts case-insensitively by body text", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
        const p1 = await repo.createPost("Need to study for Algorithms exam");

        vi.setSystemTime(new Date("2026-09-18T10:05:00Z"));
        await repo.createPost("Coffee break at 3pm");

        vi.setSystemTime(new Date("2026-09-18T10:10:00Z"));
        const p3 = await repo.createPost("Algorithms homework was brutal");

        const results = await repo.searchPosts("ALGORITHMS");
        expect(results).toHaveLength(2);
        expect(results.map((r) => r.root.id)).toEqual([p3.id, p1.id]);
        expect(results[0].rootMatches).toBe(true);
        expect(results[0].matchingReplies).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("searches replies and returns root thread context even if root body does not match", async () => {
      const root = await repo.createPost("Today was uneventful");
      const r1 = await repo.createPost("Actually, bought some great Matcha", root.id);
      await repo.createPost("Also finished the reading", root.id);

      const results = await repo.searchPosts("matcha");
      expect(results).toHaveLength(1);
      expect(results[0].root.id).toBe(root.id);
      expect(results[0].rootMatches).toBe(false); // Root didn't have 'matcha'
      expect(results[0].matchingReplies).toHaveLength(1);
      expect(results[0].matchingReplies[0].id).toBe(r1.id);
      expect(results[0].matchingReplies[0].body).toBe("Actually, bought some great Matcha");
    });

    it("includes both root match and matching reply when both match", async () => {
      const root = await repo.createPost("Deep thoughts on artificial intelligence");
      const r1 = await repo.createPost("Intelligence is a fuzzy term", root.id);
      await repo.createPost("Unrelated reply", root.id);

      const results = await repo.searchPosts("intelligence");
      expect(results).toHaveLength(1);
      expect(results[0].root.id).toBe(root.id);
      expect(results[0].rootMatches).toBe(true);
      expect(results[0].matchingReplies).toHaveLength(1);
      expect(results[0].matchingReplies[0].id).toBe(r1.id);
    });

    it("excludes deleted posts and deleted replies from search results", async () => {
      const root1 = await repo.createPost("To be deleted secret thoughts");
      const root2 = await repo.createPost("Active secret thoughts");
      const reply = await repo.createPost("Secret reply to active post", root2.id);

      await repo.deletePost(root1.id);
      await repo.deletePost(reply.id);

      const results = await repo.searchPosts("secret");
      expect(results).toHaveLength(1);
      expect(results[0].root.id).toBe(root2.id);
      expect(results[0].matchingReplies).toHaveLength(0);
    });

    it("returns empty array for empty or whitespace-only search queries", async () => {
      await repo.createPost("Some post content");

      expect(await repo.searchPosts("")).toEqual([]);
      expect(await repo.searchPosts("   \t\n  ")).toEqual([]);
    });
  });

  describe("Multi-tab BroadcastChannel live updates", () => {
    class MockBroadcastChannel {
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;
      static channels: Set<MockBroadcastChannel> = new Set();

      constructor(name: string) {
        this.name = name;
        MockBroadcastChannel.channels.add(this);
      }

      postMessage(data: unknown): void {
        for (const ch of MockBroadcastChannel.channels) {
          if (ch !== this && ch.name === this.name && ch.onmessage) {
            ch.onmessage(new MessageEvent("message", { data }));
          }
        }
      }

      close(): void {
        MockBroadcastChannel.channels.delete(this);
      }
    }

    beforeEach(() => {
      MockBroadcastChannel.channels.clear();
    });

    it("notifies repository in Tab B when Tab A creates, edits, or deletes a post", async () => {
      vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
      try {
        const tabAStore = new InMemoryPrivateStore();
        // Point both repositories to the shared underlying store (simulating shared IndexedDB origin)
        const repoA = new DearDumbassRepository(tabAStore);
        const repoB = new DearDumbassRepository(tabAStore);

        const listenerB = vi.fn();
        repoB.subscribe(listenerB);

        // Tab A creates a post
        const post = await repoA.createPost("From Tab A");
        expect(listenerB).toHaveBeenCalledTimes(1);

        // Tab A updates the post
        await repoA.updatePost(post.id, "Edited in Tab A");
        expect(listenerB).toHaveBeenCalledTimes(2);

        // Tab A replies to the post
        await repoA.createPost("Reply from Tab A", post.id);
        expect(listenerB).toHaveBeenCalledTimes(3);

        // Tab A deletes the post
        await repoA.deletePost(post.id);
        expect(listenerB).toHaveBeenCalledTimes(4);

        repoA.close();
        repoB.close();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("ignores self-originated broadcast messages and avoids event loops", async () => {
      vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
      try {
        const sharedStore = new InMemoryPrivateStore();
        const repo = new DearDumbassRepository(sharedStore);

        const listener = vi.fn();
        repo.subscribe(listener);

        // Artificially route a self-originated message to repo's channel
        const selfSourceId = (repo as unknown as { eventSourceId: string }).eventSourceId;
        const channel = (repo as unknown as { channel: MockBroadcastChannel }).channel;

        channel.onmessage?.(
          new MessageEvent("message", {
            data: { type: "change", sourceId: selfSourceId },
          }),
        );

        // Listener should NOT be called for self-originated message
        expect(listener).not.toHaveBeenCalled();

        repo.close();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("gracefully operates when BroadcastChannel is undefined in the environment", async () => {
      const originalBC = globalThis.BroadcastChannel;
      // @ts-expect-error intentionally removing BroadcastChannel to test fallback
      delete globalThis.BroadcastChannel;

      try {
        const fallbackRepo = new DearDumbassRepository(store);
        const listener = vi.fn();
        fallbackRepo.subscribe(listener);

        const post = await fallbackRepo.createPost("Fallback post");
        expect(post.body).toBe("Fallback post");
        expect(listener).toHaveBeenCalledTimes(1);

        fallbackRepo.close();
      } finally {
        globalThis.BroadcastChannel = originalBC;
      }
    });

    it("cleanly closes channel on close()", async () => {
      vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
      try {
        const repo = new DearDumbassRepository(store);
        expect(MockBroadcastChannel.channels.size).toBe(1);

        repo.close();
        expect(MockBroadcastChannel.channels.size).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("deduplicates same-tab window and BroadcastChannel notifications", async () => {
      vi.stubGlobal("window", new EventTarget());
      vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
      try {
        const sharedStore = new InMemoryPrivateStore();
        const repoA = new DearDumbassRepository(sharedStore);
        const repoB = new DearDumbassRepository(sharedStore);
        const listenerB = vi.fn();
        repoB.subscribe(listenerB);

        await repoA.createPost("One logical change");

        expect(listenerB).toHaveBeenCalledTimes(1);
        repoA.close();
        repoB.close();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("keeps same-tab updates when BroadcastChannel is unavailable", async () => {
      vi.stubGlobal("window", new EventTarget());
      vi.stubGlobal("BroadcastChannel", undefined);
      try {
        const sharedStore = new InMemoryPrivateStore();
        const repoA = new DearDumbassRepository(sharedStore);
        const repoB = new DearDumbassRepository(sharedStore);
        const listenerB = vi.fn();
        repoB.subscribe(listenerB);

        await repoA.createPost("Fallback change");

        expect(listenerB).toHaveBeenCalledTimes(1);
        repoA.close();
        repoB.close();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
