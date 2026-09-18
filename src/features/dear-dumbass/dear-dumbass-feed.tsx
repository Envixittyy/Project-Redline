"use client";

import { Radio, Send, ShieldCheck } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
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

export function DearDumbassFeed({
  repository: propRepository,
}: DearDumbassFeedProps) {
  const [repository] = useState<DearDumbassRepository>(
    () => propRepository ?? getDearDumbassRepository(),
  );

  const [posts, setPosts] = useState<DearDumbassPost[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Composer state
  const [composerInput, setComposerInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  const loadFeed = useCallback(async () => {
    try {
      const [feedPosts, counts] = await Promise.all([
        repository.getFeed(),
        repository.getReplyCounts(),
      ]);
      setPosts(feedPosts);
      setReplyCounts(counts);
    } catch (err) {
      console.error("[DearDumbass] Failed to load feed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const [feedPosts, counts] = await Promise.all([
          repository.getFeed(),
          repository.getReplyCounts(),
        ]);
        if (mounted) {
          setPosts(feedPosts);
          setReplyCounts(counts);
        }
      } catch (err) {
        console.error("[DearDumbass] Failed to load feed:", err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void refresh();

    const unsubscribe = repository.subscribe(() => {
      void refresh();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [repository]);

  const handlePostSubmit = async () => {
    const trimmed = composerInput.trim();
    if (!trimmed || isSubmitting) return;

    setPostError(null);
    setIsSubmitting(true);
    try {
      await repository.createPost(trimmed);
      await loadFeed();
      setComposerInput("");
      if (composerTextareaRef.current) {
        composerTextareaRef.current.style.height = "auto";
      }
    } catch (err) {
      console.error("[DearDumbass] Failed to submit post:", err);
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
        {postError ? (
          <div className={styles.errorBanner} role="alert">
            <span>{postError}</span>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setPostError(null)}
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <textarea
          ref={composerTextareaRef}
          className={styles.textarea}
          placeholder="Scream into the void…"
          value={composerInput}
          onChange={(e) => handleComposerChange(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={isSubmitting}
          aria-label="Post content"
          rows={3}
        />
        <div className={styles.composerFooter}>
          <span className={styles.shortcutHint}>Ctrl+Enter to post</span>
          <button
            type="button"
            className={styles.postButton}
            onClick={handlePostSubmit}
            disabled={!composerInput.trim() || isSubmitting}
            aria-label="Publish post"
          >
            <Send size={14} aria-hidden="true" />
            <span>{isSubmitting ? "Posting…" : "Post"}</span>
          </button>
        </div>
      </section>

      {/* Main Feed Content */}
      <main className={styles.feedList} aria-label="Dear Dumbass feed">
        {isLoading ? null : posts.length === 0 ? (
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
              onPostUpdated={() => loadFeed()}
              onPostDeleted={() => loadFeed()}
            />
          ))
        )}
      </main>
    </div>
  );
}
