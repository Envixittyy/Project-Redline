import { getPrivateStore, type PrivateStore } from "@/services/private-store";
import type { DearDumbassPost, DearDumbassSearchResult } from "./types";

export const DEAR_DUMBASS_STORE_NAME = "dear_dumbass_posts";
export const DEAR_DUMBASS_CHANGE_EVENT = "redline:dear-dumbass-change";
export const DEAR_DUMBASS_BROADCAST_CHANNEL = "redline:dear-dumbass-channel";

export type DearDumbassBroadcastMessage = {
  type: "change";
  sourceId: string;
};

function createPostId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure post ID generation is unavailable.");
  }
  return crypto.randomUUID();
}

export class DearDumbassRepository {
  private readonly store: PrivateStore;
  private readonly listeners = new Set<() => void>();
  private readonly eventSourceId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `repository-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private channel: BroadcastChannel | null = null;

  constructor(store?: PrivateStore) {
    this.store = store ?? getPrivateStore();
    this.initBroadcastChannel();
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    try {
      this.channel = new BroadcastChannel(DEAR_DUMBASS_BROADCAST_CHANNEL);
      this.channel.onmessage = (event: MessageEvent<DearDumbassBroadcastMessage>) => {
        const data = event.data;
        if (
          data &&
          typeof data === "object" &&
          data.type === "change" &&
          data.sourceId !== this.eventSourceId
        ) {
          this.notifyListeners();
        }
      };
    } catch {
      this.channel = null;
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Subscriber failures must not interrupt persistence or expose private content.
      }
    }
  }

  private emitChange(): void {
    this.notifyListeners();

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DEAR_DUMBASS_CHANGE_EVENT, {
          detail: { sourceId: this.eventSourceId },
        }),
      );
    }

    if (this.channel) {
      try {
        this.channel.postMessage({
          type: "change",
          sourceId: this.eventSourceId,
        } satisfies DearDumbassBroadcastMessage);
      } catch {
        // Channel closed or failed to post message.
      }
    }
  }

  /**
   * Subscribe to local post changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    let windowHandler: EventListener | null = null;
    if (typeof window !== "undefined") {
      windowHandler = (event) => {
        const detail = (event as CustomEvent<{ sourceId?: string }>).detail;
        if (detail?.sourceId !== this.eventSourceId) {
          listener();
        }
      };
      window.addEventListener(DEAR_DUMBASS_CHANGE_EVENT, windowHandler);
    }

    return () => {
      this.listeners.delete(listener);
      if (typeof window !== "undefined" && windowHandler) {
        window.removeEventListener(DEAR_DUMBASS_CHANGE_EVENT, windowHandler);
      }
    };
  }

  /**
   * Close channel and clean up resources.
   */
  close(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // Channel close failure is safely ignored.
      }
      this.channel = null;
    }
    this.listeners.clear();
  }

  /**
   * Create a new post or reply.
   */
  async createPost(
    body: string,
    replyToId?: string | null,
  ): Promise<DearDumbassPost> {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new Error("Post body cannot be blank.");
    }

    const resolvedReplyToId = replyToId ?? null;

    const post = await this.store.transaction(
      DEAR_DUMBASS_STORE_NAME,
      "readwrite",
      async (transaction) => {
        if (resolvedReplyToId) {
          const parent = await transaction.get<DearDumbassPost>(
            DEAR_DUMBASS_STORE_NAME,
            resolvedReplyToId,
          );
          if (!parent || parent.deletedAt) {
            throw new Error(
              "Cannot reply to a post that does not exist or has been deleted.",
            );
          }
          if (parent.replyToId) {
            throw new Error("Replies must belong to a root post.");
          }
        }

        const now = new Date().toISOString();
        const id = createPostId();

        const created: DearDumbassPost = {
          id,
          body: trimmed,
          createdAt: now,
          updatedAt: null,
          revision: 0,
          replyToId: resolvedReplyToId,
          deletedAt: null,
        };

        await transaction.put(DEAR_DUMBASS_STORE_NAME, created);
        return created;
      },
    );
    this.emitChange();
    return post;
  }

  /**
   * Get an active post by ID.
   */
  async getPost(id: string): Promise<DearDumbassPost | null> {
    const post = await this.store.transaction(
      DEAR_DUMBASS_STORE_NAME,
      "readonly",
      (transaction) =>
        transaction.get<DearDumbassPost>(DEAR_DUMBASS_STORE_NAME, id),
    );
    if (!post || post.deletedAt) {
      return null;
    }
    return post;
  }

  /**
   * Get all active root posts, sorted newest to oldest.
   */
  async getFeed(): Promise<DearDumbassPost[]> {
    const all = await this.store.getAll<DearDumbassPost>(
      DEAR_DUMBASS_STORE_NAME,
    );
    return all
      .filter((post) => !post.deletedAt && !post.replyToId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
  }

  /**
   * Get all active replies for a root post, sorted chronologically (oldest to newest).
   */
  async getReplies(rootPostId: string): Promise<DearDumbassPost[]> {
    const replies = await this.store.transaction(
      DEAR_DUMBASS_STORE_NAME,
      "readonly",
      async (transaction) => {
        const root = await transaction.get<DearDumbassPost>(
          DEAR_DUMBASS_STORE_NAME,
          rootPostId,
        );
        if (!root || root.deletedAt || root.replyToId) return [];

        return transaction.getAllByIndex<DearDumbassPost>(
          DEAR_DUMBASS_STORE_NAME,
          "by_replyToId",
          rootPostId,
        );
      },
    );
    return replies
      .filter((post) => !post.deletedAt && post.replyToId === rootPostId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
  }

  /**
   * Search active posts and replies locally by body text (case-insensitive).
   * Returns thread results preserving root context for matching replies.
   */
  async searchPosts(query: string): Promise<DearDumbassSearchResult[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }

    const all = await this.store.getAll<DearDumbassPost>(
      DEAR_DUMBASS_STORE_NAME,
    );

    // Exclude deleted posts (deleted posts excluded from normal search)
    const active = all.filter((post) => !post.deletedAt);

    const roots = new Map<string, DearDumbassPost>();
    const repliesByRootId = new Map<string, DearDumbassPost[]>();

    for (const post of active) {
      if (!post.replyToId) {
        roots.set(post.id, post);
      } else {
        const list = repliesByRootId.get(post.replyToId) ?? [];
        list.push(post);
        repliesByRootId.set(post.replyToId, list);
      }
    }

    const results: DearDumbassSearchResult[] = [];

    for (const [rootId, rootPost] of roots.entries()) {
      const rootMatches = rootPost.body.toLowerCase().includes(trimmed);
      const replies = repliesByRootId.get(rootId) ?? [];
      const matchingReplies = replies
        .filter((reply) => reply.body.toLowerCase().includes(trimmed))
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );

      if (rootMatches || matchingReplies.length > 0) {
        results.push({
          root: rootPost,
          matchingReplies,
          rootMatches,
        });
      }
    }

    return results.sort(
      (a, b) =>
        b.root.createdAt.localeCompare(a.root.createdAt) ||
        b.root.id.localeCompare(a.root.id),
    );
  }

  /**
   * Get reply counts grouped by root post ID.
   */
  async getReplyCounts(): Promise<Record<string, number>> {
    const all = await this.store.getAll<DearDumbassPost>(
      DEAR_DUMBASS_STORE_NAME,
    );
    const counts: Record<string, number> = {};

    for (const post of all) {
      if (!post.deletedAt && post.replyToId) {
        counts[post.replyToId] = (counts[post.replyToId] ?? 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Update an existing post or reply.
   */
  async updatePost(
    id: string,
    newBody: string,
    expectedRevision?: number,
  ): Promise<DearDumbassPost> {
    const trimmed = newBody.trim();
    if (!trimmed) {
      throw new Error("Post body cannot be blank.");
    }

    const updated = await this.store.transaction(
      DEAR_DUMBASS_STORE_NAME,
      "readwrite",
      async (transaction) => {
        const existing = await transaction.get<DearDumbassPost>(
          DEAR_DUMBASS_STORE_NAME,
          id,
        );
        if (!existing || existing.deletedAt) {
          throw new Error("Post not found or already deleted.");
        }
        const currentRevision = existing.revision ?? 0;
        if (
          expectedRevision !== undefined &&
          currentRevision !== expectedRevision
        ) {
          throw new Error("Post changed after editing began.");
        }

        const next: DearDumbassPost = {
          ...existing,
          body: trimmed,
          updatedAt: new Date().toISOString(),
          revision: currentRevision + 1,
        };
        await transaction.put(DEAR_DUMBASS_STORE_NAME, next);
        return next;
      },
    );
    this.emitChange();
    return updated;
  }

  /**
   * Delete a post or reply.
   * If deleting a root post, all child replies are cascaded into deleted state as well.
   */
  async deletePost(id: string): Promise<void> {
    const deleted = await this.store.transaction(
      DEAR_DUMBASS_STORE_NAME,
      "readwrite",
      async (transaction) => {
        const existing = await transaction.get<DearDumbassPost>(
          DEAR_DUMBASS_STORE_NAME,
          id,
        );
        if (!existing || existing.deletedAt) return false;

        const now = new Date().toISOString();
        const toUpdate: DearDumbassPost[] = [
          { ...existing, body: "", deletedAt: now },
        ];

        if (!existing.replyToId) {
          const childReplies = await transaction.getAllByIndex<DearDumbassPost>(
            DEAR_DUMBASS_STORE_NAME,
            "by_replyToId",
            id,
          );
          for (const reply of childReplies) {
            if (!reply.deletedAt) {
              toUpdate.push({ ...reply, body: "", deletedAt: now });
            }
          }
        }

        await transaction.putBatch(DEAR_DUMBASS_STORE_NAME, toUpdate);
        return true;
      },
    );
    if (deleted) this.emitChange();
  }

  /**
   * Permanently purge all deleted posts (maintenance utility).
   */
  async purgeDeleted(): Promise<number> {
    const all = await this.store.getAll<DearDumbassPost>(
      DEAR_DUMBASS_STORE_NAME,
    );
    const deletedIds = all
      .filter((post) => post.deletedAt)
      .map((post) => post.id);

    if (deletedIds.length > 0) {
      await this.store.deleteBatch(DEAR_DUMBASS_STORE_NAME, deletedIds);
      this.emitChange();
    }

    return deletedIds.length;
  }
}

let defaultRepository: DearDumbassRepository | null = null;

export function getDearDumbassRepository(
  customStore?: PrivateStore,
): DearDumbassRepository {
  if (customStore) {
    return new DearDumbassRepository(customStore);
  }
  if (!defaultRepository) {
    defaultRepository = new DearDumbassRepository();
  }
  return defaultRepository;
}
