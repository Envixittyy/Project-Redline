import { getPrivateStore, type PrivateStore } from "@/services/private-store";
import type { DearDumbassPost } from "./types";

export const DEAR_DUMBASS_STORE_NAME = "dear_dumbass_posts";
export const DEAR_DUMBASS_CHANGE_EVENT = "redline:dear-dumbass-change";

export class DearDumbassRepository {
  private readonly store: PrivateStore;
  private readonly listeners = new Set<() => void>();

  constructor(store?: PrivateStore) {
    this.store = store ?? getPrivateStore();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("[DearDumbassRepository] Listener error:", err);
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(DEAR_DUMBASS_CHANGE_EVENT));
    }
  }

  /**
   * Subscribe to local post changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    let windowHandler: (() => void) | null = null;
    if (typeof window !== "undefined") {
      windowHandler = () => listener();
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

    if (resolvedReplyToId) {
      const parent = await this.getPost(resolvedReplyToId);
      if (!parent) {
        throw new Error("Cannot reply to a post that does not exist or has been deleted.");
      }
    }

    const now = new Date().toISOString();
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `post-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const post: DearDumbassPost = {
      id,
      body: trimmed,
      createdAt: now,
      updatedAt: null,
      replyToId: resolvedReplyToId,
      deletedAt: null,
    };

    await this.store.put(DEAR_DUMBASS_STORE_NAME, post);
    this.emitChange();
    return post;
  }

  /**
   * Get an active post by ID.
   */
  async getPost(id: string): Promise<DearDumbassPost | null> {
    const post = await this.store.get<DearDumbassPost>(
      DEAR_DUMBASS_STORE_NAME,
      id,
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
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Get all active replies for a root post, sorted chronologically (oldest to newest).
   */
  async getReplies(rootPostId: string): Promise<DearDumbassPost[]> {
    const all = await this.store.getAll<DearDumbassPost>(
      DEAR_DUMBASS_STORE_NAME,
    );
    return all
      .filter((post) => !post.deletedAt && post.replyToId === rootPostId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
  async updatePost(id: string, newBody: string): Promise<DearDumbassPost> {
    const trimmed = newBody.trim();
    if (!trimmed) {
      throw new Error("Post body cannot be blank.");
    }

    const existing = await this.getPost(id);
    if (!existing) {
      throw new Error("Post not found or already deleted.");
    }

    const updated: DearDumbassPost = {
      ...existing,
      body: trimmed,
      updatedAt: new Date().toISOString(),
    };

    await this.store.put(DEAR_DUMBASS_STORE_NAME, updated);
    this.emitChange();
    return updated;
  }

  /**
   * Delete a post or reply.
   * If deleting a root post, all child replies are cascaded into deleted state as well.
   */
  async deletePost(id: string): Promise<void> {
    const existing = await this.getPost(id);
    if (!existing) {
      return;
    }

    const now = new Date().toISOString();
    const toUpdate: DearDumbassPost[] = [{ ...existing, body: "", deletedAt: now }];

    // If it's a root post, cascade deletion to child replies
    if (!existing.replyToId) {
      const all = await this.store.getAll<DearDumbassPost>(
        DEAR_DUMBASS_STORE_NAME,
      );
      const childReplies = all.filter(
        (post) => !post.deletedAt && post.replyToId === id,
      );
      for (const reply of childReplies) {
        toUpdate.push({ ...reply, body: "", deletedAt: now });
      }
    }

    await this.store.putBatch(DEAR_DUMBASS_STORE_NAME, toUpdate);
    this.emitChange();
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
