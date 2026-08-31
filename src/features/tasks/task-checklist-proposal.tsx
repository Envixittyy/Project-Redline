"use client";
import { Check, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { generateTaskChecklist } from "@/features/ai/checklist-client";
import { reviseTaskChecklistAction } from "@/features/ai/checklist-actions";
import {
  applyAiProposalAction,
  rejectAiProposalAction,
} from "@/features/ai/ai-actions";
import type { ChecklistReview } from "@/services/integrations/ai/trust-contract";
import type { Task } from "@/types/task";
import styles from "./task-checklist-proposal.module.css";

type EditableItem = { id: string; title: string; selected: boolean };
export function TaskChecklistProposal({
  task,
  onApplied,
}: {
  task: Task;
  onApplied?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<ChecklistReview | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, startApplyTransition] = useTransition();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function acceptReview(next: ChecklistReview) {
    setReview(next);
    setItems(
      next.items.map((title, i) => ({
        id: `${next.batchId}-${i}`,
        title,
        selected: true,
      })),
    );
    setDirty(false);
  }
  function close() {
    if (applying) return;
    controller.current?.abort();
    if (review) void rejectAiProposalAction(review.batchId);
    setReview(null);
    setItems([]);
    setError(null);
    setIsOpen(false);
    setLoading(false);
  }
  async function handleGenerate() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    setIsOpen(true);
    const result = await generateTaskChecklist(
      task.id,
      undefined,
      request.signal,
    );
    if (request.signal.aborted) {
      if (result.ok) void rejectAiProposalAction(result.review.batchId);
      return;
    }
    setLoading(false);
    if (result.ok) acceptReview(result.review);
    else setError(result.message);
  }
  function edit(id: string, patch: Partial<EditableItem>) {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setDirty(true);
  }
  function handleApply() {
    if (!review) return;
    setError(null);
    startApplyTransition(async () => {
      try {
        if (dirty) {
          const result = await reviseTaskChecklistAction(
            review.batchId,
            items.filter((i) => i.selected).map((i) => i.title),
          );
          if (result.ok) acceptReview(result.review);
          else setError(result.message);
          return; // A separate explicit click is required to apply this new review.
        }
        const result = await applyAiProposalAction(review.batchId);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setIsOpen(false);
        setReview(null);
        setItems([]);
        onApplied?.();
      } catch {
        setError("Checklist unavailable. Refresh the review before retrying.");
      }
    });
  }
  const selectedCount = items.filter((i) => i.selected).length;
  if (!isOpen)
    return (
      <div>
        <button
          type="button"
          className={`${styles.triggerButton} motion-interactive`}
          onClick={handleGenerate}
          disabled={loading}
        >
          <Sparkles size={15} aria-hidden="true" />
          <span>Generate checklist with AI</span>
        </button>
        <p>
          Uses this saved task’s title, description, and existing checklist with
          your selected AI mode. Cloud transfer asks first. Unsaved edits and linked materials are not
          sent.
        </p>
      </div>
    );
  return (
    <div
      className={`${styles.container} motion-enter`}
      aria-busy={loading || applying}
    >
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Sparkles size={16} />
          <span>AI Suggested Checklist</span>
        </div>
        <button
          type="button"
          className={styles.removeButton}
          onClick={close}
          disabled={applying}
          aria-label="Close suggestion"
        >
          <X size={15} />
        </button>
      </div>
      {loading && (
        <p role="status">
          <Loader2 size={16} className="animate-spin" /> Drafting checklist…
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {review && (
        <>
          <p>
            For saved task: {review.taskTitle}. Nothing changes until you apply
            this review.
          </p>
          {review.provenance && <p>Source: {review.provenance.location.replaceAll("_", " ")} · {review.provenance.provider} · {review.provenance.model}</p>}
          <fieldset
            disabled={applying}
            style={{ border: 0, padding: 0, minWidth: 0 }}
          >
            <legend className="sr-only">Checklist additions</legend>
            <div className={styles.itemList}>
              {items.map((item, index) => (
                <div key={item.id} className={styles.itemRow}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={item.selected}
                    onChange={() => edit(item.id, { selected: !item.selected })}
                    aria-label={`Include item ${index + 1}`}
                  />
                  <input
                    className={styles.itemInput}
                    value={item.title}
                    maxLength={200}
                    onChange={(e) => edit(item.id, { title: e.target.value })}
                    aria-label={`Checklist item ${index + 1}`}
                  />
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => {
                      setItems((previous) =>
                        previous.filter((i) => i.id !== item.id),
                      );
                      setDirty(true);
                    }}
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
          <p role="status">
            {dirty
              ? "Save your edits for a fresh review before applying."
              : "Review saved. Approval expires five minutes after generation started."}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={close}
              disabled={applying}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.applyButton} motion-tactile`}
              onClick={handleApply}
              disabled={applying || selectedCount === 0}
            >
              {applying ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              <span>
                {applying
                  ? "Saving…"
                  : dirty
                    ? "Review changes"
                    : `Add ${selectedCount} Subtasks`}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
