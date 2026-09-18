"use client";

import {
  CornerDownLeft,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { DearDumbassPost } from "@/services/dear-dumbass";
import { DearDumbassRepository } from "@/services/dear-dumbass";
import styles from "./dear-dumbass.module.css";

export function formatRelativeTime(isoString: string): string {
  const timestamp = new Date(isoString).getTime();
  if (Number.isNaN(timestamp)) return "";

  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export type DearDumbassCardProps = {
  post: DearDumbassPost;
  replyCount?: number;
  repository: DearDumbassRepository;
  isReply?: boolean;
  onPostUpdated?: (updated: DearDumbassPost) => void;
  onPostDeleted?: (id: string) => void;
};

export function DearDumbassCard({
  post,
  replyCount = 0,
  repository,
  isReply = false,
  onPostUpdated,
  onPostDeleted,
}: DearDumbassCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Thread replies state
  const [isThreadOpen, setIsThreadOpen] = useState(false);
  const [replies, setReplies] = useState<DearDumbassPost[]>([]);
  const [replyInput, setReplyInput] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const loadReplies = useCallback(async () => {
    if (isReply) return;
    try {
      const items = await repository.getReplies(post.id);
      setReplies(items);
    } catch (err) {
      console.error("[DearDumbass] Failed to load replies:", err);
    }
  }, [isReply, post.id, repository]);

  const handleToggleThread = () => {
    const next = !isThreadOpen;
    setIsThreadOpen(next);
    if (next) {
      void loadReplies();
    }
  };

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.selectionStart = editTextareaRef.current.value.length;
      editTextareaRef.current.selectionEnd = editTextareaRef.current.value.length;
    }
  }, [isEditing]);

  const handleSaveEdit = async () => {
    const trimmed = editBody.trim();
    if (!trimmed || isSaving) return;

    setEditError(null);
    setIsSaving(true);
    try {
      const updated = await repository.updatePost(post.id, trimmed);
      onPostUpdated?.(updated);
      setIsEditing(false);
    } catch (err) {
      console.error("[DearDumbass] Failed to update post:", err);
      setEditError("Failed to save edit locally. Your text has been preserved.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditing(false);
      setEditError(null);
      setEditBody(post.body);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await repository.deletePost(post.id);
      setIsConfirmingDelete(false);
      onPostDeleted?.(post.id);
    } catch (err) {
      console.error("[DearDumbass] Failed to delete post:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreateReply = async () => {
    const trimmed = replyInput.trim();
    if (!trimmed || isSubmittingReply) return;

    setReplyError(null);
    setIsSubmittingReply(true);
    try {
      await repository.createPost(trimmed, post.id);
      await loadReplies();
      setReplyInput("");
      if (replyTextareaRef.current) {
        replyTextareaRef.current.style.height = "auto";
      }
    } catch (err) {
      console.error("[DearDumbass] Failed to create reply:", err);
      setReplyError("Failed to save reply locally. Your text has been preserved.");
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleReplyKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleCreateReply();
    }
  };

  const handleReplyInputChange = (val: string) => {
    if (replyError) setReplyError(null);
    setReplyInput(val);
    if (replyTextareaRef.current) {
      replyTextareaRef.current.style.height = "auto";
      replyTextareaRef.current.style.height = `${Math.min(
        replyTextareaRef.current.scrollHeight,
        180,
      )}px`;
    }
  };

  return (
    <article
      className={isReply ? styles.replyCard : styles.card}
      data-testid={isReply ? `reply-card-${post.id}` : `post-card-${post.id}`}
    >
      <header className={styles.cardHeader}>
        <div className={styles.timestampRow}>
          <time
            dateTime={post.createdAt}
            title={new Date(post.createdAt).toLocaleString()}
          >
            {formatRelativeTime(post.createdAt)}
          </time>
          {post.updatedAt ? (
            <span
              className={styles.editedTag}
              title={`Edited: ${new Date(post.updatedAt).toLocaleString()}`}
            >
              (edited)
            </span>
          ) : null}
        </div>
      </header>

      {/* Body or Edit Form */}
      {isEditing ? (
        <div className={styles.editContainer}>
          {editError ? (
            <div className={styles.errorBanner} role="alert">
              <span>{editError}</span>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setEditError(null)}
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <textarea
            ref={editTextareaRef}
            className={styles.editTextarea}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            onKeyDown={handleEditKeyDown}
            aria-label="Edit post content"
            disabled={isSaving}
          />
          <div className={styles.editActions}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSaveEdit}
              disabled={isSaving || !editBody.trim()}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => {
                setIsEditing(false);
                setEditBody(post.body);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
            <span className={styles.shortcutHint}>Ctrl+Enter to save • Esc to cancel</span>
          </div>
        </div>
      ) : (
        <p className={styles.postBody}>{post.body}</p>
      )}

      {/* Delete Confirmation Banner */}
      {isConfirmingDelete ? (
        <div className={styles.deleteConfirmBanner} role="alert">
          <p className={styles.deleteConfirmText}>
            {!isReply && replyCount > 0
              ? `Delete post and its ${replyCount} ${replyCount === 1 ? "reply" : "replies"}?`
              : "Delete this permanently from your device?"}
          </p>
          <div className={styles.deleteConfirmActions}>
            <button
              type="button"
              className={styles.confirmDeleteBtn}
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => setIsConfirmingDelete(false)}
              disabled={isDeleting}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Action Controls */}
      {!isEditing && !isConfirmingDelete ? (
        <footer className={styles.actionRow}>
          {!isReply ? (
            <button
              type="button"
              className={`${styles.actionButton} ${
                isThreadOpen ? styles.actionButtonActive : ""
              }`}
              onClick={handleToggleThread}
              aria-expanded={isThreadOpen}
              aria-label={`Reply to post. ${replyCount} replies currently.`}
            >
              <MessageSquare size={15} aria-hidden="true" />
              <span>Reply</span>
              {replyCount > 0 ? (
                <span className={styles.replyBadge}>{replyCount}</span>
              ) : null}
            </button>
          ) : null}

          <button
            type="button"
            className={styles.actionButton}
            onClick={() => {
              setIsEditing(true);
              setEditBody(post.body);
            }}
            aria-label="Edit post"
          >
            <Pencil size={14} aria-hidden="true" />
            <span>Edit</span>
          </button>

          <button
            type="button"
            className={`${styles.actionButton} ${styles.deleteButton}`}
            onClick={() => setIsConfirmingDelete(true)}
            aria-label="Delete post"
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>Delete</span>
          </button>
        </footer>
      ) : null}

      {/* Nested Thread Section */}
      {!isReply && isThreadOpen ? (
        <section className={styles.threadSection} aria-label="Replies thread">
          {/* Thread Replies List */}
          {replies.length > 0 ? (
            <div className={styles.repliesList}>
              {replies.map((reply) => (
                <DearDumbassCard
                  key={reply.id}
                  post={reply}
                  isReply={true}
                  repository={repository}
                  onPostUpdated={() => loadReplies()}
                  onPostDeleted={() => loadReplies()}
                />
              ))}
            </div>
          ) : null}

          {/* Inline Reply Composer */}
          <div className={styles.replyComposer}>
            {replyError ? (
              <div className={styles.errorBanner} role="alert">
                <span>{replyError}</span>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => setReplyError(null)}
                  aria-label="Dismiss error"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            <textarea
              ref={replyTextareaRef}
              className={styles.replyTextarea}
              placeholder="Reply to yourself…"
              value={replyInput}
              onChange={(e) => handleReplyInputChange(e.target.value)}
              onKeyDown={handleReplyKeyDown}
              disabled={isSubmittingReply}
              aria-label="Reply body"
            />
            <div className={styles.replyFooter}>
              <span className={styles.shortcutHint}>Ctrl+Enter to post</span>
              <button
                type="button"
                className={styles.postButton}
                onClick={handleCreateReply}
                disabled={!replyInput.trim() || isSubmittingReply}
                aria-label="Submit reply"
              >
                <CornerDownLeft size={14} aria-hidden="true" />
                <span>{isSubmittingReply ? "Posting…" : "Reply"}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </article>
  );
}
