import { addDays } from "@/lib/date/day";
import type { CalendarEvent } from "@/types/calendar-event";
import type { CourseMeeting } from "@/types/course-meeting";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

import { dateForInstant, lastOccupiedDate } from "./calendar-date";
import {
  calendarEventToEntry,
  defaultCalendarFilters,
  matchesCalendarFilters,
  taskToCalendarEntries,
  type NativeCalendarEntry,
  type TaskDeadlineCalendarEntry,
  type TaskScheduleCalendarEntry,
  type TaskWorkSessionCalendarEntry,
  courseMeetingToCalendarEntries,
  type CourseMeetingCalendarEntry,
  workSessionToCalendarEntry,
} from "./calendar-domain";

export type CalendarItem =
  | { key: string; kind: "event"; date: string; event: CalendarEvent; entry: NativeCalendarEntry }
  | { key: string; kind: "scheduled_task"; date: string; task: Task; entry: TaskScheduleCalendarEntry }
  | { key: string; kind: "work_session"; date: string; task: Task; workSession: WorkSession; entry: TaskWorkSessionCalendarEntry }
  | { key: string; kind: "deadline"; date: string; task: Task; entry: TaskDeadlineCalendarEntry }
  | { key: string; kind: "course_meeting"; date: string; meeting: CourseMeeting; entry: CourseMeetingCalendarEntry };

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
  meetings: CourseMeeting[] = [],
  fromDate?: string,
  toDateExclusive?: string,
  workSessions: WorkSession[] = [],
  workSessionTasks: Task[] = [],
): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const event of events) {
    const entry = calendarEventToEntry(event, timeZone);
    if (!entry || !matchesCalendarFilters(entry, defaultCalendarFilters)) continue;
    for (const date of occupiedDates(entry.start!, entry.end, timeZone)) {
      items.push({ key: `${entry.key}:${date}`, kind: "event", date, event, entry });
    }
  }

  if (fromDate && toDateExclusive) {
    for (const meeting of meetings) {
      for (const entry of courseMeetingToCalendarEntries(meeting, fromDate, toDateExclusive, timeZone)) {
        if (matchesCalendarFilters(entry, defaultCalendarFilters)) {
          items.push({ key: entry.key, kind: "course_meeting", date: entry.date, meeting, entry });
        }
      }
    }
  }

  const scheduledIds = new Set(scheduledTasks.map((task) => task.id));
  const deadlineIds = new Set(deadlineTasks.map((task) => task.id));
  const tasks = new Map([...scheduledTasks, ...deadlineTasks].map((task) => [task.id, task]));
  for (const task of tasks.values()) {
    for (const entry of taskToCalendarEntries(task, timeZone)) {
      if (!matchesCalendarFilters(entry, defaultCalendarFilters)) continue;

      if (entry.kind === "task_deadline") {
        if (!deadlineIds.has(task.id)) continue;
        items.push({ key: `${entry.key}:${entry.date}`, kind: "deadline", date: entry.date, task, entry });
        continue;
      }

      if (!scheduledIds.has(task.id)) continue;
      for (const date of occupiedDates(entry.start!, entry.end, timeZone)) {
        items.push({ key: `${entry.key}:${date}`, kind: "scheduled_task", date, task, entry });
      }
    }
  }

  const sessionTasks = new Map(workSessionTasks.map((task) => [task.id, task]));
  for (const workSession of workSessions) {
    const task = sessionTasks.get(workSession.taskId);
    if (!task) continue;
    const entry = workSessionToCalendarEntry(workSession, task, timeZone);
    if (!entry || !matchesCalendarFilters(entry, defaultCalendarFilters)) continue;
    for (const date of occupiedDates(entry.start!, entry.end, timeZone)) {
      items.push({
        key: `${entry.key}:${date}`,
        kind: "work_session",
        date,
        task,
        workSession,
        entry,
      });
    }
  }

  return items.sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate !== 0) return byDate;
    const rank = { course_meeting: 0, event: 1, work_session: 2, scheduled_task: 3, deadline: 4 } as const;
    return rank[left.kind] - rank[right.kind];
  });
}
