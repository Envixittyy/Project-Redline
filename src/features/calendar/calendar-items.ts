import { addDays } from "@/lib/date/day";
import type { CalendarEvent } from "@/types/calendar-event";
import type { Task } from "@/types/task";

import { dateForInstant, lastOccupiedDate } from "./calendar-date";

export type CalendarItem =
  | { key: string; kind: "event"; date: string; event: CalendarEvent }
  | { key: string; kind: "scheduled_task"; date: string; task: Task }
  | { key: string; kind: "deadline"; date: string; task: Task };

function occupiedDates(start: string, end: string | null, timeZone: string): string[] {
  const first = dateForInstant(start, timeZone);
  const last = end ? lastOccupiedDate(end, timeZone) : first;
  const dates: string[] = [];

  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * Builds a calendar-only union. It contains references to the original domain
 * records and has no persistence path of its own.
 */
export function buildCalendarItems(
  events: CalendarEvent[],
  scheduledTasks: Task[],
  deadlineTasks: Task[],
  timeZone: string,
): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const event of events) {
    for (const date of occupiedDates(event.start, event.end, timeZone)) {
      items.push({ key: `event:${event.id}:${date}`, kind: "event", date, event });
    }
  }

  for (const task of scheduledTasks) {
    if (!task.scheduledStart) continue;
    for (const date of occupiedDates(task.scheduledStart, task.scheduledEnd, timeZone)) {
      items.push({ key: `task:${task.id}:${date}`, kind: "scheduled_task", date, task });
    }
  }

  for (const task of deadlineTasks) {
    if (task.dueDate) {
      items.push({ key: `deadline:${task.id}:${task.dueDate}`, kind: "deadline", date: task.dueDate, task });
    }
  }

  return items.sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    const rank = { event: 0, scheduled_task: 1, deadline: 2 } as const;
    return rank[left.kind] - rank[right.kind];
  });
}
