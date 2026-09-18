"use client";

import { Radio, Send, ShieldCheck } from "lucide-react";
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
} from "@/services/dear-dumbass";
import { DearDumbassCard } from "./dear-dumbass-card";
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
    });

    return () => {
      window.clearTimeout(initialLoad);
      feedLoadVersionRef.current += 1;
      unsubscribe();
    };
  }, [loadFeed, repository]);

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
        ) : isLoading || !repository ? null : posts.length === 0 ? (
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
    </div>
  );
}
