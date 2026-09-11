"use client";

import { Check, CalendarClock, CalendarDays, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
              <Badge tone="course" size="sm" variant="subtle" dot>
                {task.course}
              </Badge>
            ) : null}

            {task.project ? (
              <span className={styles.projectTag}>{task.project}</span>
            ) : null}

            {task.area && !task.project ? (
              <span className={styles.projectTag}>{task.area}</span>
            ) : null}

            {task.parentTaskId ? (
              <Badge tone="neutral" size="sm" variant="subtle">
                Subtask
              </Badge>
            ) : null}

            {task.priority === "urgent" ? (
              <Badge tone="destructive" size="sm" variant="subtle" dot>
                Urgent
              </Badge>
            ) : task.priority === "high" ? (
              <Badge tone="warning" size="sm" variant="subtle" dot>
                High
              </Badge>
            ) : task.priority === "medium" ? (
              <Badge tone="info" size="sm" variant="subtle">
                Med
              </Badge>
            ) : null}
          </span>
        </div>
      </button>
    </li>
  );
}
