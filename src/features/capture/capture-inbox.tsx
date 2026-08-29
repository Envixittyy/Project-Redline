"use client";

import { Check, ExternalLink, GraduationCap, RotateCcw, Sparkles, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import {
  acknowledgeProposalDivergenceAction,
  commitCaptureTaskAction,
  dismissProposalAction,
  prepareCaptureTaskAction,
  undoCaptureTaskAction,
} from "@/features/capture/capture-actions";
import type { CaptureInboxItem } from "@/features/capture/capture-domain";

import styles from "./capture.module.css";

export type CaptureInboxViewItem = CaptureInboxItem & {
  capturedLabel: string;
  canUndo: boolean;
};

function CaptureCard({ item }: { item: CaptureInboxViewItem }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetProposalId = searchParams?.get("proposal");
  const isTargeted = Boolean(item.proposal && item.proposal.id === targetProposalId);

  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isExternal = Boolean(item.proposal?.external);
  const external = item.proposal?.external;
  const isDivergent = external?.isDivergent ?? false;
  const isMissing = external?.isMissing ?? false;

  const text =
    item.content.kind === "text" || item.content.kind === "pasted_text"
      ? item.content.text
      : "";

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Surface
      id={item.proposal ? `proposal-${item.proposal.id}` : `capture-${item.id}`}
      data-targeted={isTargeted ? "true" : undefined}
      variant={isTargeted ? "elevated" : "base"}
      className={`${styles.captureCard} motion-enter`}
    >
      <div className={styles.captureMeta}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {isExternal ? (
            <span className={styles.sourceBadge}>
              <GraduationCap size={13} aria-hidden="true" />
              Blackboard Calendar Item
            </span>
          ) : (
            <span>{item.stage === "undone" ? "Undone" : item.stage}</span>
          )}
          {external?.courseCode ? (
            <span className={styles.courseBadge}>
              {external.courseCode}
              {external.courseName ? ` · ${external.courseName}` : ""}
            </span>
          ) : null}
        </div>
        <time dateTime={item.capturedAt}>{item.capturedLabel}</time>
      </div>

      <p className={styles.rawText}>{text}</p>

      {external ? (
        <div className={styles.proposalDetails}>
          {external.dueDate ? (
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Due: <strong>{external.dueDate}</strong>
              {external.dueAt ? ` at ${new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(new Date(external.dueAt))}` : ""}
            </span>
          ) : null}
          {external.duePrecision === "unresolved" ? (
            <span style={{ fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
              (Timezone floating — specify deadline on task)
            </span>
          ) : null}
          {external.sourceUrl ? (
            <a
              href={external.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sourceLink}
            >
              <ExternalLink size={13} aria-hidden="true" />
              Open Blackboard
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Manual text capture without proposal yet */}
      {!isExternal && (item.stage === "captured" || item.stage === "failed") ? (
        <div className={styles.cardAction}>
          <p>Ready to interpret this as a task?</p>
          <button
            className={`${styles.secondaryButton} motion-interactive`}
            type="button"
            disabled={pending}
            onClick={() => run(() => prepareCaptureTaskAction(item.id))}
          >
            <Sparkles size={17} aria-hidden="true" />
            {pending ? "Preparing…" : "Propose task"}
          </button>
        </div>
      ) : null}

      {/* Proposed review form */}
      {item.stage === "proposed" && item.proposal ? (
        <form
          className={styles.proposal}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const title = String(formData.get("title") ?? "");
            const description = item.proposal?.description ?? null;
            const dueDate = item.proposal?.dueDate ?? null;
            const dueAt = item.proposal?.dueAt ?? null;
            const courseId = item.proposal?.courseId ?? null;

            run(() =>
              commitCaptureTaskAction(
                item.id,
                item.proposal?.id,
                title,
                description,
                dueDate,
                dueAt,
                courseId,
              ),
            );
          }}
        >
          <label>
            <span>Proposed task title</span>
            <input
              name="title"
              defaultValue={item.proposal.title}
              maxLength={200}
              disabled={pending || isMissing}
            />
          </label>

          {isMissing ? (
            <div className={styles.missingNotice}>
              This item is no longer in the Blackboard feed. Adding to tasks is disabled.
            </div>
          ) : null}

          <div className={styles.proposalReview}>
            <p>Nothing is created until you confirm.</p>
            <div className={styles.actionButtons}>
              <button
                className={`${styles.dismissButton} motion-interactive`}
                type="button"
                disabled={pending}
                onClick={() => run(() => dismissProposalAction(item.proposal?.id))}
              >
                <X size={15} aria-hidden="true" />
                {pending ? "Dismissing…" : "Dismiss"}
              </button>
              <button
                className={`${styles.primaryButton} motion-interactive`}
                type="submit"
                disabled={pending || isMissing}
              >
                <Check size={17} aria-hidden="true" />
                {pending ? "Adding…" : "Add to Tasks"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {/* Committed state */}
      {item.stage === "committed" ? (
        <div className={styles.cardAction}>
          <div>
            <p>
              {item.canUndo
                ? "Task added to Tasks. You can still undo this operation."
                : "Task added to Tasks."}
            </p>
            {isDivergent ? (
              <div className={styles.divergenceNotice} style={{ marginTop: "0.5rem" }}>
                <p>Source updated on Blackboard. Your native task remains unchanged.</p>
                <button
                  className={`${styles.secondaryButton} motion-interactive`}
                  type="button"
                  style={{ minHeight: "2.2rem", padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                  disabled={pending}
                  onClick={() => run(() => acknowledgeProposalDivergenceAction(item.proposal?.id))}
                >
                  Acknowledge
                </button>
              </div>
            ) : null}
          </div>

          {item.canUndo ? (
            <button
              className={`${styles.secondaryButton} motion-interactive`}
              type="button"
              disabled={pending}
              onClick={() => run(() => undoCaptureTaskAction(item.id))}
            >
              <RotateCcw size={17} aria-hidden="true" />
              {pending ? "Undoing…" : "Undo task"}
            </button>
          ) : null}
        </div>
      ) : null}

      {item.stage === "undone" ? (
        <p className={styles.finalState}>The created task was safely removed.</p>
      ) : null}
      {item.stage === "interpreted" || item.stage === "confirmed" ? (
        <p className={styles.finalState}>
          This capture is finishing its current operation. Refresh to check again.
        </p>
      ) : null}
      {message ? (
        <p className={styles.actionError} role="alert">
          {message}
        </p>
      ) : null}
    </Surface>
  );
}

export function CaptureInbox({ items }: { items: CaptureInboxViewItem[] }) {
  if (!items.length) {
    return (
      <Surface variant="subtle" className={styles.emptyState}>
        <h2>Your Inbox is quiet</h2>
        <p>
          Capture something above or connect Blackboard in Integrations to review upcoming
          coursework.
        </p>
      </Surface>
    );
  }

  return (
    <section className={styles.inboxList} aria-label="Captured items">
      {items.map((item) => (
        <CaptureCard item={item} key={item.id} />
      ))}
    </section>
  );
}
