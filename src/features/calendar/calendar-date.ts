import { addDays, isIsoDate, todayIn } from "@/lib/date/day";

export const calendarViews = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof calendarViews)[number];

export function isCalendarView(value: unknown): value is CalendarView {
  return calendarViews.includes(value as CalendarView);
}

function dateParts(isoDate: string): [number, number, number] {
  return isoDate.split("-").map(Number) as [number, number, number];
}

export function normalizeCalendarDate(value: unknown, fallback: string): string {
  return typeof value === "string" && isIsoDate(value) ? value : fallback;
}

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = dateParts(isoDate);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth - 1, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/** Monday-based start of week. */
export function startOfWeek(isoDate: string): string {
  const [year, month, day] = dateParts(isoDate);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(isoDate, weekday === 0 ? -6 : 1 - weekday);
}

export function calendarRange(view: CalendarView, anchor: string) {
  if (view === "month") {
    const fromDate = startOfWeek(startOfMonth(anchor));
    return { fromDate, toDateExclusive: addDays(fromDate, 42) };
  }

  if (view === "week") {
    const fromDate = startOfWeek(anchor);
    return { fromDate, toDateExclusive: addDays(fromDate, 7) };
  }

  return { fromDate: anchor, toDateExclusive: addDays(anchor, 30) };
}

export function shiftCalendarAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === "week") return addDays(anchor, direction * 7);
  if (view === "agenda") return addDays(anchor, direction * 30);
  return addMonths(anchor, direction);
}

export function eachDay(fromDate: string, toDateExclusive: string): string[] {
  const days: string[] = [];
  for (let day = fromDate; day < toDateExclusive; day = addDays(day, 1)) days.push(day);
  return days;
}

export function dateForInstant(instant: string, timeZone: string): string {
  return todayIn(timeZone, new Date(instant));
}

export function lastOccupiedDate(end: string, timeZone: string): string {
  return todayIn(timeZone, new Date(Date.parse(end) - 1));
}

export function weekDaysForAnchor(anchor: string): string[] {
  const start = startOfWeek(anchor);
  return eachDay(start, addDays(start, 7));
}

export function formatCalendarHeading(view: CalendarView, anchor: string): string {
  const noon = new Date(`${anchor}T12:00:00Z`);
  if (view === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(noon);
  }

  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const startDate = new Date(`${start}T12:00:00Z`);
    const endDate = new Date(`${end}T12:00:00Z`);
    const startMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(startDate);
    const endMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(endDate);
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();
    const startDay = startDate.getUTCDate();
    const endDay = endDate.getUTCDate();

    if (startYear !== endYear) {
      return `${startMonth} ${startDay}, ${startYear} – ${endMonth} ${endDay}, ${endYear}`;
    }
    if (startMonth !== endMonth) {
      return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${endYear}`;
    }
    return `${startMonth} ${startDay}–${endDay}, ${startYear}`;
  }

  return `Next 30 days · ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${anchor}T12:00:00Z`))}`;
}
