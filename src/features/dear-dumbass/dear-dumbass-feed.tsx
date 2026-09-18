"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  HardDrive,
  Lock,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Unlock,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import {
  getDearDumbassRepository,
  type DearDumbassPost,
  type DearDumbassRepository,
  type DearDumbassSearchResult,
} from "@/services/dear-dumbass";
import type {
  DearDumbassSyncState,
  DearDumbassSyncStatus,
} from "@/services/dear-dumbass";
import { DearDumbassCard } from "./dear-dumbass-card";
import { DurabilityModal } from "./durability-modal";
import { SyncModal } from "./sync-modal";
import styles from "./dear-dumbass.module.css";

export type DearDumbassFeedProps = {
  repository?: DearDumbassRepository;
  autoFocusComposer?: boolean;
};

function subscribeToBrowserReady(): () => void {
  return () => undefined;
}

function getBrowserSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

function getSyncLabel(status: DearDumbassSyncStatus): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing…";
    case "saved_locally":
      return "Saved locally";
    case "waiting_to_sync":
      return "Waiting to sync";
    case "locked":
      return "Sync key removed";
    case "conflict":
      return "Conflict";
    case "error":
      return "Sync error";
    case "local_only":
    default:
      return "Local Only";
  }
}

function getSyncTitle(status: DearDumbassSyncStatus): string {
  switch (status) {
    case "synced":
      return "End-to-End Encrypted: Synced with cloud";
    case "syncing":
      return "End-to-End Encrypted: Sync in progress…";
    case "saved_locally":
      return "Changes saved locally; queued to sync when online";
    case "waiting_to_sync":
      return "Offline; waiting to sync when connected";
    case "locked":
      return "The cloud-sync key was removed. Local plaintext remains on this device.";
    case "conflict":
      return "Concurrent live edits detected. Click to resolve.";
    case "error":
      return "Sync failed. Click to view details and retry.";
    case "local_only":
    default:
      return "PrivateStore: Stored exclusively in your browser. Click to configure encrypted sync.";
  }
}

function getSyncIcon(status: DearDumbassSyncStatus) {
  switch (status) {
    case "synced":
      return <CheckCircle2 size={13} aria-hidden="true" />;
    case "syncing":
      return <RefreshCw size={13} className="animate-spin" aria-hidden="true" />;
    case "saved_locally":
    case "waiting_to_sync":
      return <CloudOff size={13} aria-hidden="true" />;
    case "locked":
      return <Lock size={13} aria-hidden="true" />;
    case "conflict":
      return <AlertTriangle size={13} aria-hidden="true" />;
    case "error":
      return <AlertCircle size={13} aria-hidden="true" />;
    case "local_only":
    default:
      return <ShieldCheck size={13} aria-hidden="true" />;
  }
}

function getSyncDotClass(status: DearDumbassSyncStatus): string {
  switch (status) {
    case "synced":
      return styles.syncDotSynced;
    case "saved_locally":
    case "waiting_to_sync":
      return styles.syncDotWaiting;
    case "locked":
      return styles.syncDotLocked;
    case "conflict":
      return styles.syncDotConflict;
    case "error":
      return styles.syncDotError;
    case "syncing":
    case "local_only":
    default:
      return "";
  }
}

export function DearDumbassFeed({
  repository: propRepository,
  autoFocusComposer = false,
}: DearDumbassFeedProps) {
  const browserReady = useSyncExternalStore(
    subscribeToBrowserReady,
    getBrowserSnapshot,
    getServerSnapshot,
  );
  const storageState = useMemo(() => {
    if (propRepository) {
      return { repository: propRepository, error: null };
    }
    if (!browserReady) {
      return { repository: null, error: null };
    }

    try {
      return { repository: getDearDumbassRepository(), error: null };
    } catch {
      return {
        repository: null,
        error:
          "Local browser storage is unavailable. Dear Dumbass has not sent or saved anything.",
      };
    }
  }, [browserReady, propRepository]);
  const repository = storageState.repository;
  const storageError = storageState.error;

  const [posts, setPosts] = useState<DearDumbassPost[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);

  // Composer state
  const [composerInput, setComposerInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const feedLoadVersionRef = useRef(0);

  // Durability / Backup modal state
  const [isDurabilityOpen, setIsDurabilityOpen] = useState(false);

  // Sync state & modal
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncState, setSyncState] = useState<DearDumbassSyncState>(() => {
    if (repository) {
      return repository.getSyncCoordinator().getState();
    }
    return {
      status: "local_only",
      lastSyncedAt: null,
      pendingCount: 0,
      conflictCount: 0,
      errorMessage: null,
      isUnlocked: true,
    };
  });
  const [inlineUnlockPassphrase, setInlineUnlockPassphrase] = useState("");
  const [inlineUnlockError, setInlineUnlockError] = useState<string | null>(null);
  const [isInlineUnlocking, setIsInlineUnlocking] = useState(false);

  const handleInlineUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repository || !inlineUnlockPassphrase) return;
    const passphrase = inlineUnlockPassphrase;
    setInlineUnlockPassphrase("");
    setInlineUnlockError(null);
    setIsInlineUnlocking(true);
    try {
      await repository.getSyncCoordinator().unlockSync(passphrase);
      await loadFeed();
    } catch (err) {
      if (mountedRef.current) {
        setInlineUnlockError(err instanceof Error ? err.message : "Incorrect passphrase.");
      }
    } finally {
      if (mountedRef.current) {
        setIsInlineUnlocking(false);
      }
    }
  };

  // Search state (strictly local in-memory, never in URL query string)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DearDumbassSearchResult[] | null>(null);
  const searchVersionRef = useRef(0);
  const searchQueryRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submitInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    let shouldFocus = autoFocusComposer;
    if (!shouldFocus && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      shouldFocus = params.get("compose") === "true";
    }

    if (shouldFocus && composerTextareaRef.current) {
      composerTextareaRef.current.focus();
      const frame = window.requestAnimationFrame(() => {
        composerTextareaRef.current?.focus();
        composerTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [autoFocusComposer]);

  const performSearch = useCallback(
    async (query: string) => {
      if (!repository) return;
      const version = ++searchVersionRef.current;
      const trimmed = query.trim();
      if (!trimmed) {
        if (version === searchVersionRef.current) setSearchResults(null);
        return;
      }

      try {
        const results = await repository.searchPosts(trimmed);
        if (version === searchVersionRef.current) {
          setSearchResults(results);
        }
      } catch {
        if (version === searchVersionRef.current) {
          setSearchResults([]);
        }
      }
    },
    [repository],
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    searchQueryRef.current = value;
    void performSearch(value);
  };

  const handleClearSearch = () => {
    searchVersionRef.current += 1;
    setSearchQuery("");
    searchQueryRef.current = "";
    setSearchResults(null);
  };

  const loadFeed = useCallback(async () => {
    if (!repository) return;
    const loadVersion = ++feedLoadVersionRef.current;
    try {
      const [feedPosts, counts] = await Promise.all([
        repository.getFeed(),
        repository.getReplyCounts(),
      ]);
      if (loadVersion !== feedLoadVersionRef.current) return;
      setPosts(feedPosts);
      setReplyCounts(counts);
      setFeedError(null);
    } catch {
      if (loadVersion === feedLoadVersionRef.current) {
        setFeedError("Failed to load posts from local browser storage.");
      }
    } finally {
      if (loadVersion === feedLoadVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [repository]);

  useEffect(() => {
    if (!repository) return;

    const coordinator = repository.getSyncCoordinator();
    void coordinator.initialize();

    const initialLoad = window.setTimeout(() => {
      void loadFeed();
      if (searchQueryRef.current.trim()) {
        void performSearch(searchQueryRef.current);
      }
    }, 0);

    const unsubscribeRepo = repository.subscribe(() => {
      void loadFeed();
      if (searchQueryRef.current.trim()) {
        void performSearch(searchQueryRef.current);
      }
    });

    const unsubscribeSync = coordinator.subscribe((newState) => {
      setSyncState(newState);
      if (newState.isUnlocked) {
        void loadFeed();
      }
    });

    return () => {
      window.clearTimeout(initialLoad);
      feedLoadVersionRef.current += 1;
      searchVersionRef.current += 1;
      unsubscribeRepo();
      unsubscribeSync();
    };
  }, [loadFeed, performSearch, repository]);

  const handlePostSubmit = async () => {
    const trimmed = composerInput.trim();
    if (!repository || !trimmed || submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    setPostError(null);
    setIsSubmitting(true);
    try {
      await repository.createPost(trimmed);
      if (!mountedRef.current) return;
      setComposerInput("");
      if (composerTextareaRef.current) {
        composerTextareaRef.current.style.height = "auto";
      }
    } catch {
      if (mountedRef.current) {
        setPostError("Failed to save post locally. Your text has been preserved.");
      }
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handlePostSubmit();
    }
  };

  const handleComposerChange = (val: string) => {
    if (postError) setPostError(null);
    setComposerInput(val);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = "auto";
      composerTextareaRef.current.style.height = `${Math.min(
        composerTextareaRef.current.scrollHeight,
        380,
      )}px`;
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>Dear Dumbass</h1>
            <p className={styles.population}>Population: 1</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.durabilityButton}
              onClick={() => setIsDurabilityOpen(true)}
              aria-label="Manage storage durability and encrypted backup"
              title="Storage Durability & Encrypted Backup"
            >
              <HardDrive size={13} aria-hidden="true" />
              <span>Backup &amp; Durability</span>
            </button>
            <button
              type="button"
              className={styles.syncBadgeButton}
              onClick={() => setIsSyncModalOpen(true)}
              title={getSyncTitle(syncState.status)}
              aria-label={`Sync status: ${getSyncLabel(syncState.status)}`}
              data-testid="dear-dumbass-sync-status"
            >
              <span
                className={`${styles.syncDot} ${getSyncDotClass(syncState.status)}`}
                aria-hidden="true"
              />
              {getSyncIcon(syncState.status)}
              <span>{getSyncLabel(syncState.status)}</span>
            </button>
          </div>
        </div>
      </header>

      {syncState.status === "locked" ? (
        <section
          className={styles.lockedSurface}
          aria-label="Cloud sync key removed"
          data-testid="dear-dumbass-locked"
        >
          <div className={styles.lockedIcon}>
            <Lock size={30} aria-hidden="true" />
          </div>
          <h2 className={styles.lockedTitle}>Cloud Sync Key Removed</h2>
          <p className={styles.lockedDescription}>
            Your local journal remains readable because its plaintext records stay in this
            browser&apos;s PrivateStore. Enter the master passphrase only to restore the local
            encryption key and resume cloud synchronization.
          </p>
          <form onSubmit={handleInlineUnlock} className={styles.lockedForm}>
            {inlineUnlockError ? (
              <div className={styles.errorBanner} role="alert">
                <span>{inlineUnlockError}</span>
              </div>
            ) : null}
            <input
              type="password"
              className={styles.lockedInput}
              placeholder="Master passphrase…"
              value={inlineUnlockPassphrase}
              onChange={(e) => setInlineUnlockPassphrase(e.target.value)}
              disabled={isInlineUnlocking}
              autoFocus
              required
            />
            <button
              type="submit"
              className={styles.lockedSubmitButton}
              disabled={isInlineUnlocking || !inlineUnlockPassphrase}
            >
              <Unlock size={14} aria-hidden="true" />
              <span>{isInlineUnlocking ? "Restoring…" : "Resume Encrypted Sync"}</span>
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setIsSyncModalOpen(true)}
            >
              Manage Sync Settings
            </button>
          </form>
        </section>
      ) : null}

        <>
          {/* Primary Composer */}
          <section className={styles.composerSurface} aria-label="Compose post">
            {storageError || postError ? (
              <div className={styles.errorBanner} role="alert">
                <span>{storageError ?? postError}</span>
                {!storageError ? (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => setPostError(null)}
                    aria-label="Dismiss error"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            ) : null}
            <textarea
              ref={composerTextareaRef}
              className={styles.textarea}
              placeholder="Scream into the void…"
              value={composerInput}
              onChange={(e) => handleComposerChange(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={!repository || isSubmitting}
              aria-label="Post content"
              rows={3}
              autoFocus={autoFocusComposer}
            />
            <div className={styles.composerFooter}>
              <span className={styles.shortcutHint}>Ctrl+Enter to post</span>
              <button
                type="button"
                className={styles.postButton}
                onClick={handlePostSubmit}
                disabled={!repository || !composerInput.trim() || isSubmitting}
                aria-label="Publish post"
              >
                <Send size={14} aria-hidden="true" />
                <span>{isSubmitting ? "Posting…" : "Post"}</span>
              </button>
            </div>
          </section>

          {/* Local Search Control */}
          <section className={styles.searchSection} aria-label="Search thoughts locally">
            <div className={styles.searchBar}>
              <Search size={15} className={styles.searchIcon} aria-hidden="true" />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search thoughts & replies locally…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                disabled={!repository}
                aria-label="Search thoughts locally"
              />
              {searchQuery.trim() ? (
                <button
                  type="button"
                  className={styles.searchClearBtn}
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {searchResults !== null ? (
              <div className={styles.searchStatusRow} role="status">
                <span className={styles.searchCount}>
                  {searchResults.length === 0
                    ? `No thoughts found matching "${searchQuery.trim()}"`
                    : `Found ${searchResults.length} ${
                        searchResults.length === 1 ? "thread" : "threads"
                      } matching "${searchQuery.trim()}"`}
                </span>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={handleClearSearch}
                >
                  Clear
                </button>
              </div>
            ) : null}
          </section>

          {/* Main Feed Content */}
          <main className={styles.feedList} aria-label="Dear Dumbass feed">
            {feedError ? (
              <div className={styles.errorBanner} role="alert">
                <span>{feedError}</span>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void loadFeed()}
                >
                  Retry
                </button>
              </div>
            ) : isLoading || !repository ? null : searchResults !== null ? (
              searchResults.length === 0 ? (
                <div className={styles.emptyState} data-testid="dear-dumbass-search-empty">
                  <Search size={36} className={styles.emptyIcon} aria-hidden="true" />
                  <h2 className={styles.emptyTitle}>Nothing found in the void.</h2>
                  <p className={styles.emptyDescription}>
                    No thoughts or replies matched &quot;{searchQuery.trim()}&quot;.
                  </p>
                </div>
              ) : (
                searchResults.map((result) => {
                  const matchingIds = new Set(result.matchingReplies.map((r) => r.id));
                  const hasMatchingReplies = result.matchingReplies.length > 0;
                  return (
                    <DearDumbassCard
                      key={`search-${result.root.id}`}
                      post={result.root}
                      replyCount={replyCounts[result.root.id] ?? 0}
                      repository={repository}
                      initialOpenThread={hasMatchingReplies}
                      matchingReplyIds={matchingIds}
                      isSearchMatch={result.rootMatches}
                      contextNote={
                        !result.rootMatches && hasMatchingReplies
                          ? `${result.matchingReplies.length} matching ${
                              result.matchingReplies.length === 1 ? "reply" : "replies"
                            } in thread`
                          : undefined
                      }
                    />
                  );
                })
              )
            ) : posts.length === 0 ? (
              <div className={styles.emptyState} data-testid="dear-dumbass-empty-state">
                <Radio size={36} className={styles.emptyIcon} aria-hidden="true" />
                <h2 className={styles.emptyTitle}>The void is listening.</h2>
                <p className={styles.emptyDescription}>
                  Unfortunately, it&apos;s just you.
                </p>
              </div>
            ) : (
              posts.map((post) => (
                <DearDumbassCard
                  key={post.id}
                  post={post}
                  replyCount={replyCounts[post.id] ?? 0}
                  repository={repository}
                />
              ))
            )}
          </main>
        </>

      {isDurabilityOpen && repository ? (
        <DurabilityModal
          repository={repository}
          onClose={() => setIsDurabilityOpen(false)}
        />
      ) : null}

      {isSyncModalOpen && repository ? (
        <SyncModal
          repository={repository}
          onClose={() => setIsSyncModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
