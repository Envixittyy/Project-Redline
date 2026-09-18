"use client";

import { HardDrive, Radio, Search, Send, ShieldCheck, X } from "lucide-react";
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
import { DearDumbassCard } from "./dear-dumbass-card";
import { DurabilityModal } from "./durability-modal";
import styles from "./dear-dumbass.module.css";

export type DearDumbassFeedProps = {
  repository?: DearDumbassRepository;
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

export function DearDumbassFeed({
  repository: propRepository,
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
  const feedLoadVersionRef = useRef(0);

  // Durability / Backup modal state
  const [isDurabilityOpen, setIsDurabilityOpen] = useState(false);

  // Search state (strictly local in-memory, never in URL query string)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DearDumbassSearchResult[] | null>(null);
  const searchVersionRef = useRef(0);
  const searchQueryRef = useRef("");

  const performSearch = useCallback(
    async (query: string) => {
      if (!repository) return;
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchResults(null);
        return;
      }

      const version = ++searchVersionRef.current;
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

    const initialLoad = window.setTimeout(() => {
      void loadFeed();
    }, 0);

    const unsubscribe = repository.subscribe(() => {
      void loadFeed();
      if (searchQueryRef.current.trim()) {
        void performSearch(searchQueryRef.current);
      }
    });

    return () => {
      window.clearTimeout(initialLoad);
      feedLoadVersionRef.current += 1;
      unsubscribe();
    };
  }, [loadFeed, performSearch, repository]);

  const handlePostSubmit = async () => {
    const trimmed = composerInput.trim();
    if (!repository || !trimmed || isSubmitting) return;

    setPostError(null);
    setIsSubmitting(true);
    try {
      await repository.createPost(trimmed);
      setComposerInput("");
      if (composerTextareaRef.current) {
        composerTextareaRef.current.style.height = "auto";
      }
    } catch {
      setPostError("Failed to save post locally. Your text has been preserved.");
    } finally {
      setIsSubmitting(false);
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
            <span
              className={styles.privacyBadge}
              title="PrivateStore: Stored exclusively in your browser. Never sent to any server or cloud API."
              aria-label="Storage status: Local Only"
            >
              <span className={styles.privacyDot} aria-hidden="true" />
              <ShieldCheck size={13} aria-hidden="true" />
              <span>Local Only</span>
            </span>
          </div>
        </div>
      </header>

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

      {isDurabilityOpen && repository ? (
        <DurabilityModal
          repository={repository}
          onClose={() => setIsDurabilityOpen(false)}
        />
      ) : null}
    </div>
  );
}
