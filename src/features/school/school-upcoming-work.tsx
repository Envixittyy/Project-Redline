"use client";

import { useState, useTransition } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MinusCircle,
} from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import type { SchoolItem } from "@/types/school-item";
import { setTaskCompletionAction } from "@/features/tasks/task-actions";
import { dueTone, formatDueDate } from "@/features/tasks/task-formatting";
import { SchoolItemBadge } from "./school-item-badge";
import { isSchoolItemTaskCompleted } from "./school-ui-domain";
import styles from "./school-upcoming-work.module.css";

type SchoolUpcomingWorkProps = {
  items: SchoolItem[];
  courses: CourseWithMeetings[];
  today: string;
  timeZone: string;
  onSelectCourse?: (courseId: string) => void;
  title?: string;
};

function formatTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function SchoolUpcomingWork({
  items,
  courses,
  today,
  timeZone,
  onSelectCourse,
  title = "Upcoming Work",
}: SchoolUpcomingWorkProps) {
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Filter for actionable items: assignments, quizzes, exams
  const actionable = items.filter(
    (item) =>
      item.itemType === "assignment" ||
      item.itemType === "quiz" ||
      item.itemType === "exam",
  );

  // Sort by deadline: items with due dates ascending (earliest first), then null due dates
  const sorted = [...actionable].sort((a, b) => {
    // Both have due dates
    if (a.dueDate && b.dueDate) {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    }
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.title.localeCompare(b.title);
  });

  const courseMap = new Map(courses.map((c) => [c.id, c]));

  const handleToggleComplete = (item: SchoolItem) => {
    if (!item.taskId) return;
    const currentCompleted = isSchoolItemTaskCompleted(item);
    const nextCompleted = !currentCompleted;

    setBusyTaskId(item.taskId);
    startTransition(async () => {
      await setTaskCompletionAction(item.taskId, nextCompleted);
      setBusyTaskId(null);
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>
          <span>{title}</span>
          <span className={styles.countBadge}>{sorted.length}</span>
        </h3>
      </div>

      {sorted.length === 0 ? (
        <div className={styles.emptyState}>
          <CheckCircle2 size={28} aria-hidden="true" />
          <p><strong>Nothing due right now</strong></p>
          <p>You&apos;re completely caught up on assignments, quizzes, and exams.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {sorted.map((item) => {
            const course = courseMap.get(item.courseId);
            const isCompleted = isSchoolItemTaskCompleted(item);
            const isBusy = busyTaskId === item.taskId;
            const tone = item.dueDate ? dueTone(item.dueDate, today) : "upcoming";
            const dueLabel = item.dueDate
              ? formatDueDate(item.dueDate, today)
              : "No due date";
            const timeLabel = item.dueAt ? formatTime(item.dueAt, timeZone) : null;

            return (
              <li
                key={item.id}
                className={styles.row}
                data-completed={isCompleted || undefined}
              >
                {item.taskId ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isCompleted}
                    aria-label={
                      isCompleted
                        ? `Mark ${item.title} as incomplete`
                        : `Complete ${item.title}`
                    }
                    className={styles.checkButton}
                    disabled={isBusy}
                    onClick={() => handleToggleComplete(item)}
                  >
                    {isBusy ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : isCompleted ? (
                      <Check size={16} aria-hidden="true" />
                    ) : null}
                  </button>
                ) : (
                  <div
                    className={styles.noTaskIndicator}
                    title="Informational / Task unlinked"
                    aria-label="No linked task"
                  >
                    <MinusCircle size={16} />
                  </div>
                )}

                <div className={styles.body}>
                  <div className={styles.topLine}>
                    <SchoolItemBadge itemType={item.itemType} />

                    {course ? (
                      <button
                        type="button"
                        className={styles.coursePill}
                        onClick={() => onSelectCourse?.(course.id)}
                        aria-label={`Filter by course ${course.code}`}
                      >
                        <span
                          className={styles.swatch}
                          style={{
                            backgroundColor: course.color ?? "var(--accent)",
                          }}
                          aria-hidden="true"
                        />
                        <span>{course.code}</span>
                      </button>
                    ) : null}

                    <span className={styles.title}>{item.title}</span>
                  </div>

                  <div className={styles.metaLine}>
                    <span className={styles.dueBadge} data-tone={tone}>
                      <CalendarDays size={13} aria-hidden="true" />
                      <span>
                        {dueLabel}
                        {timeLabel ? ` at ${timeLabel}` : ""}
                      </span>
                    </span>

                    {item.weight !== null ? (
                      <span className={styles.weightBadge}>
                        Weight: {item.weight}%
                      </span>
                    ) : null}

                    {item.sourceUrl ? (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.blackboardLink}
                        aria-label={`Open ${item.title} in Blackboard`}
                      >
                        <span>Open in Blackboard</span>
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
