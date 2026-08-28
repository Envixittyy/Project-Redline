"use client";

import { Check, CalendarClock, CalendarDays, Loader2 } from "lucide-react";

import { taskPriorityLabel, type Task } from "@/types/task";

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

export function TaskRow({ task, today, timeZone, busy, onToggleComplete, onOpen }: TaskRowProps) {
  const completed = task.status === "completed";
  const showPriority = task.priority === "medium" || task.priority === "high" || task.priority === "urgent";
  const labels = [task.parentTaskId ? "Subtask" : null, task.area, task.project, task.course].filter(Boolean) as string[];

  return (
    <li className={styles.row} data-completed={completed || undefined} data-busy={busy || undefined}>
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
          <Loader2 className={styles.spinner} size={16} aria-hidden="true" />
        ) : (
          <Check className={styles.checkMark} size={16} aria-hidden="true" />
        )}
      </button>

      <button type="button" className={styles.body} onClick={() => onOpen(task)}>
        <span className={styles.title}>{task.title}</span>

        <span className={styles.meta}>
          {task.dueDate ? (
            <span className={styles.metaItem} data-tone={dueTone(task.dueDate, today)}>
              <CalendarDays size={13} aria-hidden="true" />
              {formatDueDate(task.dueDate, today)}
            </span>
          ) : null}

          {task.scheduledStart ? (
            <span className={styles.metaItem} data-scheduled="true">
              <CalendarClock size={13} aria-hidden="true" />
              {formatScheduled(task.scheduledStart, task.scheduledEnd, today, timeZone)}
            </span>
          ) : null}

          {showPriority ? (
            <span className={styles.metaItem} data-priority={task.priority}>
              {taskPriorityLabel(task.priority)}
            </span>
          ) : null}

          {labels.map((label) => (
            <span className={styles.metaItem} key={label} data-label="true">
              {label}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
