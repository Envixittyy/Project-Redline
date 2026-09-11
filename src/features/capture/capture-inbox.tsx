"use client";

import {
  Check,
  ExternalLink,
  GraduationCap,
  Inbox,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
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

type TriageFilter = "review" | "committed" | "all";

function QueueItemCard({ item }: { item: CaptureInboxViewItem }) {
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
    <li
      id={item.proposal ? `proposal-${item.proposal.id}` : `capture-${item.id}`}
      data-targeted={isTargeted ? "true" : undefined}
      className={`${styles.queueItem} motion-enter`}
    >
      {/* Top Metadata Row */}
      <div className={styles.itemMeta}>
        <div className={styles.itemBadges}>
          {isExternal ? (
            <Badge tone="course" size="sm" icon={<GraduationCap size={12} aria-hidden="true" />}>
              Blackboard Item
            </Badge>
          ) : (
            <Badge
              tone={
                item.stage === "proposed"
                  ? "accent"
                  : item.stage === "committed"
                  ? "success"
                  : item.stage === "undone"
                  ? "neutral"
                  : "info"
              }
              size="sm"
            >
              {item.stage === "proposed"
                ? "Needs Review"
                : item.stage === "committed"
                ? "Added to Tasks"
                : item.stage === "undone"
                ? "Undone"
                : item.stage}
            </Badge>
          )}

          {external?.courseCode ? (
            <Badge tone="neutral" size="sm">
              {external.courseCode}
              {external.courseName ? ` · ${external.courseName}` : ""}
            </Badge>
          ) : null}
        </div>

        <time className={styles.timeLabel} dateTime={item.capturedAt}>
          {item.capturedLabel}
        </time>
      </div>

      {/* Raw Captured Text */}
      <p className={styles.rawText}>{text}</p>

      {/* External Blackboard Metadata */}
      {external ? (
        <div className={styles.sourceDetails}>
          {external.dueDate ? (
            <span>
              Due: <strong>{external.dueDate}</strong>
              {external.dueAt
                ? ` at ${new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(
                    new Date(external.dueAt),
                  )}`
                : ""}
            </span>
          ) : null}
          {external.duePrecision === "unresolved" ? (
            <span style={{ color: "var(--text-tertiary)" }}>
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
        <div className={styles.committedRow}>
          <span>Ready to interpret this as a task?</span>
          <Button
            variant="secondary"
            size="sm"
            icon={<Sparkles size={14} aria-hidden="true" />}
            disabled={pending}
            onClick={() => run(() => prepareCaptureTaskAction(item.id))}
          >
            {pending ? "Preparing…" : "Propose task"}
          </Button>
        </div>
      ) : null}

      {/* Proposed review form */}
      {item.stage === "proposed" && item.proposal ? (
        <form
          className={styles.proposalForm}
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
          <div className={styles.proposalTitleGroup}>
            <label htmlFor={`proposal-title-${item.id}`}>Proposed task title</label>
            <input
              id={`proposal-title-${item.id}`}
              name="title"
              defaultValue={item.proposal.title}
              maxLength={200}
              disabled={pending || isMissing}
              className={styles.proposalInput}
            />
          </div>

          {isMissing ? (
            <Callout variant="warning">
              This item is no longer in the Blackboard feed. Adding to tasks is disabled.
            </Callout>
          ) : null}

          <div className={styles.proposalActionsRow}>
            <p className={styles.proposalHelpText}>Nothing is created until you confirm.</p>
            <div className={styles.buttonGroup}>
              <Button
                variant="ghost"
                size="sm"
                icon={<X size={14} aria-hidden="true" />}
                disabled={pending}
                onClick={() => run(() => dismissProposalAction(item.proposal?.id))}
              >
                {pending ? "Dismissing…" : "Dismiss"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                icon={<Check size={14} aria-hidden="true" />}
                disabled={pending || isMissing}
              >
                {pending ? "Adding…" : "Add to Tasks"}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {/* Committed state */}
      {item.stage === "committed" ? (
        <div className={styles.committedRow}>
          <span>
            {item.canUndo
              ? "Task added to Tasks. You can still safely undo."
              : "Task added to Tasks."}
          </span>

          {item.canUndo ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={14} aria-hidden="true" />}
              disabled={pending}
              onClick={() => run(() => undoCaptureTaskAction(item.id))}
            >
              {pending ? "Undoing…" : "Undo task"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {isDivergent ? (
        <Callout
          variant="warning"
          title="Source updated on Blackboard"
          action={
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => run(() => acknowledgeProposalDivergenceAction(item.proposal?.id))}
            >
              Acknowledge
            </Button>
          }
        >
          Source changed on Blackboard. Your native task remains unchanged.
        </Callout>
      ) : null}

      {item.stage === "undone" ? (
        <p className={styles.finalStateText}>The created task was safely removed.</p>
      ) : null}
      {item.stage === "interpreted" || item.stage === "confirmed" ? (
        <p className={styles.finalStateText}>
          Finishing current operation. Refresh to check again.
        </p>
      ) : null}

      {message ? (
        <Callout variant="error" role="alert">
          {message}
        </Callout>
      ) : null}
    </li>
  );
}

export function CaptureInbox({ items }: { items: CaptureInboxViewItem[] }) {
  const [filter, setFilter] = useState<TriageFilter>("review");

  const counts = useMemo(() => {
    let reviewCount = 0;
    let committedCount = 0;
    for (const item of items) {
      if (
        item.stage === "proposed" ||
        item.stage === "captured" ||
        item.stage === "failed"
      ) {
        reviewCount++;
      } else if (item.stage === "committed") {
        committedCount++;
      }
    }
    return { review: reviewCount, committed: committedCount, all: items.length };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === "review") {
      return items.filter(
        (i) =>
          i.stage === "proposed" ||
          i.stage === "captured" ||
          i.stage === "failed",
      );
    }
    if (filter === "committed") {
      return items.filter((i) => i.stage === "committed");
    }
    return items;
  }, [items, filter]);

  if (!items.length) {
    return (
      <Surface variant="subtle" style={{ padding: "2rem 1.5rem" }}>
        <EmptyState
          icon={<Inbox size={36} />}
          title="Your Inbox is clear"
          description="Capture something above or connect Blackboard in Integrations to review upcoming coursework."
        />
      </Surface>
    );
  }

  return (
    <section className={styles.triageQueue} aria-label="Triage queue">
      <div className={styles.queueHeader}>
        <SegmentedControl
          value={filter}
          onChange={(val) => setFilter(val as TriageFilter)}
          options={[
            {
              value: "review",
              label: `Needs Review (${counts.review})`,
            },
            {
              value: "committed",
              label: `Committed (${counts.committed})`,
            },
            {
              value: "all",
              label: `All (${counts.all})`,
            },
          ]}
        />
      </div>

      {filteredItems.length > 0 ? (
        <ul className={styles.queueList} role="list">
          {filteredItems.map((item) => (
            <QueueItemCard item={item} key={item.id} />
          ))}
        </ul>
      ) : (
        <Surface variant="subtle" style={{ padding: "2rem 1.5rem" }}>
          <EmptyState
            icon={<Inbox size={32} />}
            title={
              filter === "review"
                ? "No items need review"
                : filter === "committed"
                ? "No committed tasks yet"
                : "No captured items"
            }
            description={
              filter === "review"
                ? "All captured items have been processed or committed."
                : "Your captured tasks and history will appear here."
            }
          />
        </Surface>
      )}
    </section>
  );
}
