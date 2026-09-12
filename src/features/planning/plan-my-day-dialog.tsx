"use client";

import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { Task } from "@/types/task";

import { Checkbox } from "@/components/ui";
import { applyPlanAction } from "./planning-actions";
import {
  generateDayPlan,
  type DayPlanProposal,
} from "./planning-domain";
import { DailyPlanAiPanel } from "./daily-plan-ai-panel";
import styles from "./plan-my-day-dialog.module.css";

type PlanMyDayDialogProps = {
  tasks: Task[];
  scheduleItems: CalendarItem[];
  timeZone: string;
  onClose: () => void;
};

export function PlanMyDayDialog({
  tasks,
  scheduleItems,
  timeZone,
  onClose,
}: PlanMyDayDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const plan: DayPlanProposal = useMemo(() => {
    return generateDayPlan({
      tasks,
      scheduleItems,
      timeZone,
    });
  }, [tasks, scheduleItems, timeZone]);

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => {
    return new Set(plan.proposedSessions.map((s) => s.id));
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  function toggleSession(id: string) {
    if (isSubmitting || feedback?.type === "success") return;
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleApplyPlan() {
    if (isSubmitting || selectedSessionIds.size === 0) return;
    setIsSubmitting(true);
    setFeedback(null);

    const sessionsToCommit = plan.proposedSessions
      .filter((s) => selectedSessionIds.has(s.id))
      .map((s) => ({
        taskId: s.task.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      }));

    const result = await applyPlanAction({ sessions: sessionsToCommit });

    setIsSubmitting(false);
    if (result.ok) {
      const sessionWord = result.createdCount === 1 ? "session" : "sessions";
      const msg = result.createdCount > 0
        ? `Saved ${result.createdCount} work ${sessionWord} to your calendar.`
        : "Selected work sessions are already scheduled.";
      setFeedback({ type: "success", message: msg });
      setTimeout(() => {
        onClose();
      }, 1200);
    } else {
      setFeedback({ type: "error", message: result.message });
    }
  }

  function formatTime(iso: string) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));
  }

  const plannedHours = Math.floor(plan.totalPlannedWorkMinutes / 60);
  const plannedMins = plan.totalPlannedWorkMinutes % 60;
  const plannedTimeStr = plannedHours > 0 ? `${plannedHours}h ${plannedMins}m` : `${plannedMins}m`;
  const selectedCount = selectedSessionIds.size;

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} motion-enter`}
      aria-labelledby="plan-my-day-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className={styles.form}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Deterministic Planning Engine</p>
            <h2 id="plan-my-day-title">Plan My Day</h2>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close planning modal"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          {feedback ? (
            <div
              className={`${styles.feedbackBanner} ${
                feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError
              } motion-enter`}
              role="status"
            >
              {feedback.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertTriangle size={18} aria-hidden="true" />
              )}
              <span>{feedback.message}</span>
            </div>
          ) : null}

          <div className={styles.summaryBar}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Planned Focus</span>
              <span className={styles.metricValue}>{plannedTimeStr}</span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Proposed Sessions</span>
              <span className={styles.metricValue}>{plan.proposedSessions.length}</span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Fixed Commitments</span>
              <span className={styles.metricValue}>{plan.fixedCommitments.length}</span>
            </div>
          </div>

          <DailyPlanAiPanel
            tasks={tasks}
            scheduleItems={scheduleItems}
            timeZone={timeZone}
          />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Proposed Work Sessions</h3>

            {plan.proposedSessions.length > 0 ? (
              <ul className={styles.sessionList}>
                {plan.proposedSessions.map((session) => {
                  const isSelected = selectedSessionIds.has(session.id);
                  const isPartial = session.isPartial;

                  return (
                    <li
                      key={session.id}
                      className={styles.sessionCard}
                      data-selected={isSelected}
                    >
                      <Checkbox
                        className={styles.sessionCheckbox}
                        checked={isSelected}
                        onChange={() => toggleSession(session.id)}
                        disabled={isSubmitting || feedback?.type === "success"}
                        aria-label={`Select session for ${session.task.title}`}
                      />
                      <div className={styles.sessionTime}>
                        <span className={styles.timeRange}>
                          {formatTime(session.startsAt)} – {formatTime(session.endsAt)}
                        </span>
                        <span className={styles.durationBadge}>
                          {session.durationMinutes} min focus
                        </span>
                      </div>

                      <div className={styles.sessionInfo}>
                        <span className={styles.sessionTitle}>{session.task.title}</span>
                        <div className={styles.sessionMeta}>
                          {session.task.course ? (
                            <span className={styles.tag}>{session.task.course}</span>
                          ) : null}
                          {session.task.project ? (
                            <span className={styles.tag}>{session.task.project}</span>
                          ) : null}
                          <span className={styles.tag}>Priority: {session.task.priority}</span>
                          {session.task.dueDate ? (
                            <span className={styles.tag}>Due: {session.task.dueDate}</span>
                          ) : null}
                          {isPartial ? (
                            <span className={styles.partialBadge}>
                              Partial: {session.scheduledTaskMinutes}/{session.totalTaskDuration}m
                            </span>
                          ) : (
                            <span className={styles.tag}>
                              <CheckCircle2 size={12} style={{ marginRight: 3, display: "inline" }} />
                              Full
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.emptyState}>
                <Clock size={28} className={styles.emptyIcon} aria-hidden="true" />
                <h4 className={styles.emptyHeadline}>Nothing to schedule.</h4>
                <p className={styles.emptySubtext}>
                  Your current tasks and commitments don’t leave anything useful to place.
                </p>
              </div>
            )}
          </div>

          {plan.unscheduledTasks.length > 0 ? (
            <div className={styles.unscheduledContainer}>
              <div className={styles.unscheduledHeader}>
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{plan.unscheduledTasks.length} Unscheduled Task{plan.unscheduledTasks.length === 1 ? "" : "s"}</span>
              </div>
              <ul className={styles.unscheduledList}>
                {plan.unscheduledTasks.map((u) => (
                  <li key={u.task.id} className={styles.unscheduledItem}>
                    <span className={styles.unscheduledItemTitle}>{u.task.title}</span>
                    <span className={styles.unscheduledItemReason}>{u.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerNotice}>
            <Info size={15} aria-hidden="true" />
            <span>
              Explicit confirmation persists selected sessions to task_work_sessions and projects them to your calendar.
            </span>
          </div>

          <div className={styles.footerActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClose}
              disabled={isSubmitting}
            >
              Dismiss
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={isSubmitting || selectedCount === 0 || feedback?.type === "success"}
              onClick={handleApplyPlan}
              title={
                selectedCount === 0
                  ? "Select at least one work session to apply"
                  : "Commit selected work sessions to your calendar"
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" style={{ marginRight: 6, display: "inline" }} />
                  Applying Plan...
                </>
              ) : (
                <>
                  <CalendarCheck size={16} style={{ marginRight: 6, display: "inline" }} />
                  {selectedCount === 0
                    ? "Select Sessions"
                    : `Apply Plan (${selectedCount} session${selectedCount === 1 ? "" : "s"})`}
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
