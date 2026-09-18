import { getPrivateStore, type PrivateStore } from "@/services/private-store";
import {
  createEncryptedBackup,
  validateArchivePayload,
  type DearDumbassArchivePayload,
  type DearDumbassBackupEnvelope,
  type RestoreMode,
  type RestoreResult,
} from "./backup";
import type { DearDumbassPost, DearDumbassSearchResult } from "./types";

export const DEAR_DUMBASS_STORE_NAME = "dear_dumbass_posts";
export const DEAR_DUMBASS_CHANGE_EVENT = "redline:dear-dumbass-change";
export const DEAR_DUMBASS_BROADCAST_CHANNEL = "redline:dear-dumbass-channel";

export type DearDumbassBroadcastMessage = {
  type: "change";
  sourceId: string;
  changeId: string;
};

const MAX_TRACKED_CHANGE_IDS = 100;

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
  private changeSequence = 0;
  private readonly seenChangeIds = new Set<string>();
  private windowHandler: EventListener | null = null;

  constructor(store?: PrivateStore) {
    this.store = store ?? getPrivateStore();
    this.initWindowEvents();
    this.initBroadcastChannel();
  }

  private initWindowEvents(): void {
    if (typeof window === "undefined") return;
    this.windowHandler = (event) => {
      this.handleExternalChange(
        (event as CustomEvent<DearDumbassBroadcastMessage>).detail,
      );
    };
    window.addEventListener(DEAR_DUMBASS_CHANGE_EVENT, this.windowHandler);
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    try {
      this.channel = new BroadcastChannel(DEAR_DUMBASS_BROADCAST_CHANNEL);
      this.channel.onmessage = (event: MessageEvent<DearDumbassBroadcastMessage>) => {
        this.handleExternalChange(event.data);
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

  private handleExternalChange(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const message = data as Partial<DearDumbassBroadcastMessage>;
    if (
      message.type !== "change" ||
      typeof message.sourceId !== "string" ||
      typeof message.changeId !== "string" ||
      message.sourceId === this.eventSourceId ||
      this.seenChangeIds.has(message.changeId)
    ) {
      return;
    }

    this.seenChangeIds.add(message.changeId);
    if (this.seenChangeIds.size > MAX_TRACKED_CHANGE_IDS) {
      const oldest = this.seenChangeIds.values().next().value;
      if (oldest) this.seenChangeIds.delete(oldest);
    }
    this.notifyListeners();
  }

  private emitChange(): void {
    this.notifyListeners();

    const message: DearDumbassBroadcastMessage = {
      type: "change",
      sourceId: this.eventSourceId,
      changeId: `${this.eventSourceId}:${++this.changeSequence}`,
    };

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DEAR_DUMBASS_CHANGE_EVENT, {
          detail: message,
        }),
      );
    }

    if (this.channel) {
      try {
        this.channel.postMessage(message);
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

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Close channel and clean up resources.
   */
  close(): void {
    if (typeof window !== "undefined" && this.windowHandler) {
      window.removeEventListener(DEAR_DUMBASS_CHANGE_EVENT, this.windowHandler);
      this.windowHandler = null;
    }
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // Channel close failure is safely ignored.
      }
      this.channel = null;
    }
    this.seenChangeIds.clear();
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
        const nextRevision = (existing.revision ?? 0) + 1;
        const toUpdate: DearDumbassPost[] = [
          {
            ...existing,
            body: "",
            updatedAt: now,
            revision: nextRevision,
            deletedAt: now,
          },
        ];

        if (!existing.replyToId) {
          const childReplies = await transaction.getAllByIndex<DearDumbassPost>(
            DEAR_DUMBASS_STORE_NAME,
            "by_replyToId",
            id,
          );
          for (const reply of childReplies) {
            if (!reply.deletedAt) {
              toUpdate.push({
                ...reply,
                body: "",
                updatedAt: now,
                revision: (reply.revision ?? 0) + 1,
                deletedAt: now,
              });
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

  /**
   * Export an encrypted backup envelope containing all posts and deletion tombstones.
   * Encryption is performed via Web Crypto (PBKDF2 + AES-GCM).
   */
  async exportArchive(passphrase: string): Promise<DearDumbassBackupEnvelope> {
    const all = await this.store.getAll<DearDumbassPost>(DEAR_DUMBASS_STORE_NAME);
    return createEncryptedBackup(all, passphrase);
  }

  /**
   * Restore an archive into the local store using an atomic transaction.
   * - Validates schema and records before database writes are initiated.
   * - In "merge" mode (default), preserves existing local data and tombstones.
   * - In "replace" mode, atomically clears the store and restores all archive records.
   * - Emits change event on success across current window and other tabs.
   */
  async restoreArchive(
    payload: DearDumbassArchivePayload,
    mode: RestoreMode = "merge",
  ): Promise<RestoreResult> {
    if (mode !== "merge" && mode !== "replace") {
      throw new Error("Unsupported restore mode.");
    }
    const validated = validateArchivePayload(payload);

    const result = await this.store.transaction(
      DEAR_DUMBASS_STORE_NAME,
      "readwrite",
      async (transaction) => {
        if (mode === "replace") {
          await transaction.clear(DEAR_DUMBASS_STORE_NAME);
          if (validated.posts.length > 0) {
            await transaction.putBatch(DEAR_DUMBASS_STORE_NAME, validated.posts);
          }
          return {
            mode,
            restoredCount: validated.posts.length,
            updatedCount: 0,
            preservedCount: 0,
            totalProcessed: validated.posts.length,
          };
        }

        const existingList = await transaction.getAll<DearDumbassPost>(
          DEAR_DUMBASS_STORE_NAME,
        );
        const existingMap = new Map(existingList.map((p) => [p.id, p]));
        const mergedMap = new Map(existingMap);
        let preservedCount = 0;

        for (const incoming of validated.posts) {
          const existing = existingMap.get(incoming.id);

          if (!existing) {
            mergedMap.set(incoming.id, incoming);
            continue;
          }

          if (
            existing.createdAt !== incoming.createdAt ||
            existing.replyToId !== incoming.replyToId
          ) {
            throw new Error(
              "Backup conflicts with immutable post identity or parent relationship.",
            );
          }

          const existingDeleted = Boolean(existing.deletedAt);
          const incomingDeleted = Boolean(incoming.deletedAt);

          if (existingDeleted) {
            // Local post was already deleted & scrubbed. Tombstone MUST be preserved!
            preservedCount += 1;
            continue;
          }

          if (incomingDeleted) {
            // Deletion is terminal. It dominates live versions regardless of
            // revision or clock skew and always scrubs the retained body.
            mergedMap.set(incoming.id, {
              ...existing,
              body: "",
              revision: Math.max(
                existing.revision ?? 0,
                incoming.revision ?? 0,
              ),
              deletedAt: incoming.deletedAt,
            });
            continue;
          }

          const existingRev = existing.revision ?? 0;
          const incomingRev = incoming.revision ?? 0;

          if (incomingRev > existingRev) {
            mergedMap.set(incoming.id, incoming);
          } else {
            // Revisions are authoritative. Timestamps are deliberately not a
            // tie-breaker because device clock skew can make updatedAt regress.
            preservedCount += 1;
          }
        }

        // A root tombstone is terminal for the whole thread. This also scrubs
        // local replies omitted from an imported archive and prevents a new
        // imported reply from retaining plaintext under a deleted local root.
        for (const root of mergedMap.values()) {
          if (root.replyToId || !root.deletedAt) continue;
          for (const post of mergedMap.values()) {
            if (post.replyToId !== root.id || post.deletedAt) continue;
            mergedMap.set(post.id, {
              ...post,
              body: "",
              updatedAt: root.deletedAt,
              revision: (post.revision ?? 0) + 1,
              deletedAt: root.deletedAt,
            });
          }
        }

        const toPut: DearDumbassPost[] = [];
        let restoredCount = 0;
        let updatedCount = 0;
        for (const [id, post] of mergedMap) {
          const existing = existingMap.get(id);
          if (!existing) {
            toPut.push(post);
            restoredCount += 1;
          } else if (JSON.stringify(existing) !== JSON.stringify(post)) {
            toPut.push(post);
            updatedCount += 1;
          }
        }

        if (toPut.length > 0) {
          await transaction.putBatch(DEAR_DUMBASS_STORE_NAME, toPut);
        }

        return {
          mode,
          restoredCount,
          updatedCount,
          preservedCount,
          totalProcessed: validated.posts.length,
        };
      },
    );

    this.emitChange();
    return result;
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
