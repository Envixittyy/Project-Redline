"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";

import { setTaskCompletionAction } from "@/features/tasks/task-actions";

import type { FocusNow, FocusReadModel, FocusTodayItem } from "./focus-domain";
import styles from "./focus-view.module.css";

function subscribeToClock(callback: () => void) {
  const interval = setInterval(callback, 10_000);
  return () => clearInterval(interval);
}

function getClockSnapshot(): number {
  return Date.now();
}

function getServerSnapshot(): number | null {
  return null;
}

function useCurrentTimestamp(): number | null {
  return useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerSnapshot);
}

type FocusViewProps = {
  initialReadModel: FocusReadModel;
  timeZone: string;
};

export function FocusView({ initialReadModel, timeZone }: FocusViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const currentTimestamp = useCurrentTimestamp();

  // Keyboard navigation: Esc to exit Focus Mode
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        router.push("/");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  async function handleToggleTaskCompletion(taskId: string, currentCompleted: boolean) {
    const nextCompleted = !currentCompleted;
    setCompletedTaskIds((prev) => {
      const next = new Set(prev);
      if (nextCompleted) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });

    startTransition(async () => {
      await setTaskCompletionAction(taskId, nextCompleted);
      router.refresh();
    });
  }

  const { now, next, todayItems } = initialReadModel;

  // Format header clock
  const formattedTime = currentTimestamp
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(currentTimestamp))
    : "–:–";

  const formattedDate = currentTimestamp
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(currentTimestamp))
    : "";

  // Dynamic countdown calculation for NOW item if timed
  function renderNowCountdown(item: FocusNow) {
    if (item.kind === "active_work_session" || item.kind === "active_commitment") {
      const endMs = Date.parse(item.endsAt);
      const nowMs = currentTimestamp ?? endMs;
      const remainingMinutes = Math.max(0, Math.round((endMs - nowMs) / 60_000));

      const timeFormat = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      });

      return (
        <span className={styles.focalTimerBadge}>
          <Clock size={13} aria-hidden="true" />
          {remainingMinutes > 0
            ? `${remainingMinutes}m remaining · until ${timeFormat.format(new Date(item.endsAt))}`
            : `Ending now (${timeFormat.format(new Date(item.endsAt))})`}
        </span>
      );
    }

    if (item.kind === "imminent_commitment") {
      const startMs = Date.parse(item.startsAt);
      const nowMs = currentTimestamp ?? startMs;
      const minsUntil = Math.max(1, Math.round((startMs - nowMs) / 60_000));

      return (
        <span className={styles.focalTimerBadge}>
          <Clock size={13} aria-hidden="true" />
          {`Starts in ${minsUntil}m`}
        </span>
      );
    }

    if (item.kind === "next_action_task") {
      return (
        <span className={styles.focalTimerBadge}>
          <Sparkles size={13} aria-hidden="true" />
          {`~${item.estimatedMinutes}m focus`}
        </span>
      );
    }

    return null;
  }

  function renderNowIcon(item: FocusNow) {
    switch (item.kind) {
      case "active_work_session":
        return <Zap size={15} aria-hidden="true" />;
      case "active_commitment":
      case "imminent_commitment":
        return item.source === "course_meeting" ? (
          <BookOpen size={15} aria-hidden="true" />
        ) : (
          <CalendarDays size={15} aria-hidden="true" />
        );
      case "next_action_task":
        return <Sparkles size={15} aria-hidden="true" />;
      case "all_caught_up":
        return <CheckCircle2 size={15} aria-hidden="true" />;
      case "empty_day":
      default:
        return <Compass size={15} aria-hidden="true" />;
    }
  }

  function renderItemIcon(item: FocusTodayItem): ReactNode {
    switch (item.kind) {
      case "course_meeting":
        return <BookOpen size={15} aria-hidden="true" />;
      case "work_session":
      case "scheduled_task":
        return <Clock size={15} aria-hidden="true" />;
      case "overdue_deadline":
        return <AlertCircle size={15} aria-hidden="true" />;
      default:
        return <CalendarDays size={15} aria-hidden="true" />;
    }
  }

  // Check if NOW task is completed
  const nowTaskId =
    now.kind === "active_work_session" || now.kind === "next_action_task"
      ? now.task.id
      : null;
  const isNowTaskCompleted = nowTaskId ? completedTaskIds.has(nowTaskId) : false;

  return (
    <div className={styles.container}>
      {/* Top Floating Bar */}
      <header className={`${styles.topbar} motion-enter`}>
        <div className={styles.topbarLeft}>
          <Link
            href="/"
            className={`${styles.exitButton} motion-interactive`}
            aria-label="Exit Focus Mode (or press Escape)"
            title="Exit Focus Mode"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Exit Focus</span>
          </Link>
          <div className={styles.modeBadge}>
            <span className={styles.pulseDot} aria-hidden="true" />
            <span>Goldfish Mode</span>
          </div>
        </div>

        <div className={styles.clockDisplay}>
          <span className={styles.clockTime}>{formattedTime}</span>
          <span className={styles.clockDate}>{formattedDate}</span>
        </div>
      </header>

      {/* Main Focal Surface: NOW */}
      <section
        className={`${styles.focalCard} motion-enter`}
        aria-labelledby="focus-now-title"
      >
        <div className={styles.focalGlow} aria-hidden="true" />

        <div className={styles.focalHeader}>
          <div className={styles.focalEyebrow}>
            {renderNowIcon(now)}
            <span>NOW</span>
          </div>
          {renderNowCountdown(now)}
        </div>

        <h1 id="focus-now-title" className={styles.focalTitle}>
          {now.title}
        </h1>

        {/* Context metadata */}
        <div className={styles.focalMeta}>
          {"meta" in now && now.meta ? (
            <span
              className={styles.metaTag}
              style={now.color ? { borderLeftColor: now.color, borderLeftWidth: 3 } : undefined}
            >
              {now.meta}
            </span>
          ) : null}

          {now.kind === "next_action_task" ? (
            <span className={styles.metaTag}>{now.reason}</span>
          ) : null}

          {now.kind === "all_caught_up" || now.kind === "empty_day" ? (
            <p>{now.message}</p>
          ) : null}
        </div>

        {/* Focal Actions */}
        {nowTaskId ? (
          <div className={styles.focalActions}>
            <button
              type="button"
              className={`${styles.completeButton} motion-interactive`}
              data-completed={isNowTaskCompleted || undefined}
              onClick={() => handleToggleTaskCompletion(nowTaskId, isNowTaskCompleted)}
            >
              <Check size={16} aria-hidden="true" />
              <span>{isNowTaskCompleted ? "Completed" : "Complete task"}</span>
            </button>

            <Link
              href="/tasks?view=today"
              className={`${styles.secondaryAction} motion-interactive`}
            >
              View in Tasks
            </Link>
          </div>
        ) : null}
      </section>

      {/* Secondary Surface: NEXT */}
      {next ? (
        <section
          className={`${styles.nextCard} motion-enter`}
          aria-labelledby="focus-next-title"
        >
          <div className={styles.nextHeader}>
            <div className={styles.nextEyebrow}>
              <ArrowRight size={13} aria-hidden="true" />
              <span>NEXT UP</span>
            </div>
            {"minutesUntilStart" in next ? (
              <span className={styles.nextMeta}>
                in {next.minutesUntilStart}m
              </span>
            ) : null}
          </div>

          <h2 id="focus-next-title" className={styles.nextTitle}>
            {next.title}
          </h2>

          <div className={styles.nextMeta}>
            {"meta" in next && next.meta ? (
              <span>{next.meta} · </span>
            ) : null}
            {"durationMinutes" in next ? (
              <span>{next.durationMinutes}m planned</span>
            ) : "estimatedMinutes" in next ? (
              <span>~{next.estimatedMinutes}m focus</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* TODAY'S ESSENTIALS */}
      <section className={`${styles.todaySection} motion-enter`} aria-labelledby="focus-today-title">
        <div className={styles.todayHeader}>
          <h2 id="focus-today-title" className={styles.todayTitle}>
            Today’s Essentials
          </h2>
          <span className={styles.todayCount}>
            {todayItems.length} {todayItems.length === 1 ? "item" : "items"}
          </span>
        </div>

        {todayItems.length > 0 ? (
          <ul className={styles.todayList} role="list">
            {todayItems.map((item) => {
              const isTask = Boolean(item.task);
              const isCompleted = item.task ? completedTaskIds.has(item.task.id) : false;

              return (
                <li key={item.key} className={`${styles.todayItem} motion-interactive`}>
                  <div className={styles.todayItemLeft}>
                    {isTask && item.task ? (
                      <button
                        type="button"
                        className={styles.checkboxButton}
                        data-checked={isCompleted || undefined}
                        aria-label={isCompleted ? `Mark ${item.title} as incomplete` : `Mark ${item.title} as complete`}
                        onClick={() => handleToggleTaskCompletion(item.task!.id, isCompleted)}
                      >
                        {isCompleted ? <Check size={14} aria-hidden="true" /> : null}
                      </button>
                    ) : (
                      <span className={styles.itemIconWrapper}>
                        {renderItemIcon(item)}
                      </span>
                    )}

                    <div className={styles.itemContent}>
                      <strong
                        className={styles.itemTitle}
                        data-completed={isCompleted || undefined}
                      >
                        {item.title}
                      </strong>
                      {item.meta ? (
                        <small className={styles.itemMeta}>{item.meta}</small>
                      ) : null}
                    </div>
                  </div>

                  <span
                    className={styles.itemTiming}
                    data-overdue={item.isOverdue || undefined}
                  >
                    {item.timing}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.emptyState}>
            <h3>Nothing else today</h3>
            <p>Your commitments and deadlines for today are clear. Keep the focus on what is in front of you.</p>
          </div>
        )}
      </section>
    </div>
  );
}
