import { addDays } from "@/lib/date/day";

/**
 * Formatting is deterministic on purpose: every helper takes the reference day
 * and time zone resolved on the server, and pins a locale, so a row renders
 * identically during server rendering and after hydration.
 */

const LOCALE = "en-US";

/** A due date is a calendar day, so it is always formatted as written. */
export function formatDueDate(isoDate: string, today: string): string {
  if (isoDate === today) return "Today";
  if (isoDate === addDays(today, 1)) return "Tomorrow";
  if (isoDate === addDays(today, -1)) return "Yesterday";

  const sameYear = isoDate.slice(0, 4) === today.slice(0, 4);

  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export type DueTone = "overdue" | "today" | "upcoming";

export function dueTone(isoDate: string, today: string): DueTone {
  if (isoDate < today) return "overdue";
  if (isoDate === today) return "today";

  return "upcoming";
}

function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(iso: string, today: string, timeZone: string): string {
  return formatDueDate(dayIn(iso, timeZone), today);
}

/**
 * A scheduled interval lives on the task itself. Showing it here does not make
 * the task a calendar event.
 */
export function formatScheduled(
  startIso: string,
  endIso: string | null,
  today: string,
  timeZone: string,
): string {
  const startDay = dayLabel(startIso, today, timeZone);
  const startTime = timeIn(startIso, timeZone);

  if (!endIso) return `${startDay} at ${startTime}`;

  const sameDay = dayIn(startIso, timeZone) === dayIn(endIso, timeZone);
  const endTime = timeIn(endIso, timeZone);

  if (sameDay) return `${startDay}, ${startTime} – ${endTime}`;

  return `${startDay} ${startTime} → ${dayLabel(endIso, today, timeZone)} ${endTime}`;
}
