"use client";

import { Check, CalendarClock, CalendarDays, Loader2 } from "lucide-react";

import type { Task } from "@/types/task";

import { dueTone, formatDueDate, formatScheduled } from "./task-formatting";
import styles from "./task-row.module.css";

type TaskRowProps = {
  task: Task;
  today: string;
  timeZone: string;
  busy: boolean;
  onToggleComplete: (task: Task, completed: boolean) => void;
  onOpen: (task: Task) => void;
};

export function TaskRow({
  task,
  today,
  timeZone,
  busy,
  onToggleComplete,
  onOpen,
}: TaskRowProps) {
  const completed = task.status === "completed";

  return (
    <li
      className={styles.row}
      data-completed={completed || undefined}
      data-busy={busy || undefined}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={completed}
        aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className={styles.check}
        disabled={busy}
        onClick={() => onToggleComplete(task, !completed)}
      >
        {busy ? (
          <Loader2 className={styles.spinner} size={15} aria-hidden="true" />
        ) : (
          <Check className={styles.checkMark} size={14} strokeWidth={2.5} aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        className={styles.body}
        onClick={() => onOpen(task)}
      >
        <div className={styles.mainContent}>
          <span className={styles.title}>{task.title}</span>

          <span className={styles.meta}>
            {task.dueDate ? (
              <span
                className={styles.metaItem}
                data-tone={dueTone(task.dueDate, today)}
              >
                <CalendarDays size={12} aria-hidden="true" />
                <span>{formatDueDate(task.dueDate, today)}</span>
              </span>
            ) : null}

            {task.scheduledStart ? (
              <span className={styles.metaItem} data-scheduled="true">
                <CalendarClock size={12} aria-hidden="true" />
                <span>
                  {formatScheduled(
                    task.scheduledStart,
                    task.scheduledEnd,
                    today,
                    timeZone,
                  )}
                </span>
              </span>
            ) : null}

            {task.course ? (
              <span className={styles.courseTag}>{task.course}</span>
            ) : null}

            {task.project ? (
              <span className={styles.projectTag}>{task.project}</span>
            ) : null}

            {task.area && !task.project ? (
              <span className={styles.projectTag}>{task.area}</span>
            ) : null}

            {task.parentTaskId ? (
              <span className={styles.metaLabel}>Subtask</span>
            ) : null}

            {task.priority === "urgent" ? (
              <span className={styles.priorityLabel} data-priority="urgent">Urgent</span>
            ) : task.priority === "high" ? (
              <span className={styles.priorityLabel} data-priority="high">High</span>
            ) : task.priority === "medium" ? (
              <span className={styles.priorityLabel} data-priority="medium">Med</span>
            ) : null}
          </span>
        </div>
      </button>
    </li>
  );
}
