import {
  BookOpen,
  CalendarDays,
  CircleDot,
  Clock3,
} from "lucide-react";
import type { ReactNode } from "react";

import type { CalendarItem } from "@/features/calendar/calendar-items";

import styles from "./home-dashboard.module.css";

function formatTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

export function formatScheduleTiming(item: CalendarItem, timeZone: string): string {
  if (item.entry.allDay) return "All day";
  if (!item.entry.start) return "Scheduled";

  const start = formatTime(item.entry.start, timeZone);
  if (!item.entry.end) return start;
  const end = formatTime(item.entry.end, timeZone);
  return `${start} – ${end}`;
}

export function scheduleItemTitle(item: CalendarItem): string {
  if (item.kind === "event") return item.event.title;
  if (item.kind === "external_event") return item.externalEvent.title;
  if (item.kind === "course_meeting") return item.meeting.title;
  return item.task.title;
}

export function scheduleItemMeta(item: CalendarItem): string {
  if (item.kind === "course_meeting") {
    return item.entry.courseLabel ?? item.meeting.course.label ?? "Course";
  }
  if (item.kind === "external_event") {
    const provider =
      item.externalEvent.provider === "microsoft"
        ? "Outlook"
        : item.externalEvent.provider === "google"
          ? "Google Calendar"
          : item.externalEvent.provider;
    return item.externalEvent.calendarName
      ? `${item.externalEvent.calendarName} (${provider})`
      : provider;
  }
  if (item.kind === "event") {
    if (item.event.course) return item.event.course;
    return "Event";
  }
  if (item.kind === "work_session") {
    return item.task.course ? `${item.task.course} · Work session` : "Planned work session";
  }
  if (item.kind === "scheduled_task") {
    return item.task.course ? `${item.task.course} · Scheduled task` : "Scheduled task";
  }
  return "Deadline";
}

export function scheduleItemIcon(item: CalendarItem): ReactNode {
  switch (item.kind) {
    case "course_meeting":
      return <BookOpen size={13} aria-hidden="true" />;
    case "event":
    case "external_event":
      return <CircleDot size={13} aria-hidden="true" />;
    case "work_session":
    case "scheduled_task":
      return <Clock3 size={13} aria-hidden="true" />;
    default:
      return <CalendarDays size={13} aria-hidden="true" />;
  }
}

type HomeScheduleProps = {
  items: CalendarItem[];
  timeZone: string;
  empty?: string;
};

export function HomeScheduleList({
  items,
  timeZone,
  empty = "Nothing scheduled for today. Your day is open.",
}: HomeScheduleProps) {
  if (!items.length) {
    return <p className={styles.empty}>{empty}</p>;
  }

  return (
    <ul className={styles.scheduleList}>
      {items.slice(0, 6).map((item) => {
        const customColor =
          item.kind === "course_meeting"
            ? item.entry.courseColor
            : undefined;

        return (
          <li key={item.key} className={styles.scheduleItem} data-kind={item.kind}>
            <span
              className={styles.sourceIndicator}
              style={customColor ? { background: customColor } : undefined}
              aria-hidden="true"
            />
            <div className={styles.scheduleContent}>
              <div className={styles.scheduleRow}>
                <strong className={styles.scheduleTitle}>{scheduleItemTitle(item)}</strong>
                <span className={styles.scheduleTime}>
                  {formatScheduleTiming(item, timeZone)}
                </span>
              </div>
              <div className={styles.scheduleMetaRow}>
                <span className={styles.scheduleIconWrapper}>
                  {scheduleItemIcon(item)}
                </span>
                <small className={styles.scheduleMeta}>{scheduleItemMeta(item)}</small>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
