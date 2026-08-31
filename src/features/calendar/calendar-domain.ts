import {
  addDays,
  fromZonedInputValue,
  isIsoDate,
  isIsoInstant,
  isValidTimeZone,
  toZonedInputValue,
  todayIn,
} from "@/lib/date/day";
import type { CalendarEvent } from "@/types/calendar-event";
import type { CourseMeeting } from "@/types/course-meeting";
import type { ExternalCalendarProjection } from "@/types/external-calendar";
import type { Task, TaskPatch } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

export type CalendarDataIssue =
  | "invalid_deadline"
  | "invalid_schedule_start"
  | "invalid_schedule_end"
  | "schedule_end_before_start";

type CalendarEntryBase = {
  key: string;
  title: string;
  /** Display-zone day used to group the first occurrence of the entry. */
  date: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  courseKey: string | null;
  courseLabel: string | null;
  courseColor: string | null;
  issues: readonly CalendarDataIssue[];
};

export type TaskDeadlineCalendarEntry = CalendarEntryBase & {
  kind: "task_deadline";
  task: Task;
  duePrecision: "date" | "instant";
  overdue: boolean;
};

export type TaskScheduleCalendarEntry = CalendarEntryBase & {
  kind: "task_schedule";
  task: Task;
  overdue: boolean;
};

export type TaskWorkSessionCalendarEntry = CalendarEntryBase & {
  kind: "task_work_session";
  task: Task;
  workSession: WorkSession;
  overdue: boolean;
};

export type NativeCalendarEntry = CalendarEntryBase & {
  kind: "calendar_event";
  event: CalendarEvent;
};

export type ExternalCalendarEntry = CalendarEntryBase & {
  kind: "external_calendar_event";
  externalEvent: ExternalCalendarProjection;
};

export type CourseMeetingCalendarEntry = CalendarEntryBase & {
  kind: "course_meeting";
  meeting: CourseMeeting;
  occurrenceDate: string;
};

export type AssessmentPredictionCalendarEntry = CalendarEntryBase & {
  kind: "assessment_prediction";
  prediction: {
    id: string;
    courseId: string;
    title: string;
    predictionType: string;
    predictedDate: string;
    predictedTime: string | null;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    rationale: string;
    sourceReference: string | null;
  };
};

export type CalendarEntry =
  | TaskDeadlineCalendarEntry
  | TaskScheduleCalendarEntry
  | TaskWorkSessionCalendarEntry
  | NativeCalendarEntry
  | ExternalCalendarEntry
  | CourseMeetingCalendarEntry
  | AssessmentPredictionCalendarEntry;

export type CalendarFilters = {
  showCalendarEvents: boolean;
  showTasks: boolean;
  showCourseMeetings: boolean;
  showPredictions: boolean;
  showDone: boolean;
  showSubmitted: boolean;
  showAllDay: boolean;
  showDeadlines: boolean;
  showScheduled: boolean;
  /** Empty means every course. Keys are task course text or course identity IDs. */
  courseKeys: readonly string[];
};

export const defaultCalendarFilters: CalendarFilters = {
  showCalendarEvents: true,
  showTasks: true,
  showCourseMeetings: true,
  showPredictions: true,
  showDone: false,
  showSubmitted: true,
  showAllDay: true,
  showDeadlines: true,
  showScheduled: true,
  courseKeys: [],
};

function taskCourse(task: Task) {
  return {
    courseKey: task.course,
    courseLabel: task.course,
    courseColor: null,
  };
}

function canBecomeOverdue(task: Task): boolean {
  return task.status === "inbox" || task.status === "todo" || task.status === "in_progress";
}

/**
 * Date-only deadlines become overdue at the start of the following local day.
 * Exact deadlines become overdue immediately after their instant. Submitted,
 * completed, and cancelled work is never marked overdue.
 */
export function isTaskOverdue(
  task: Task,
  now: Date = new Date(),
  timeZone: string,
): boolean {
  if (!canBecomeOverdue(task) || Number.isNaN(now.getTime())) return false;
  if (task.dueAt && isIsoInstant(task.dueAt)) return now.getTime() > Date.parse(task.dueAt);
  if (!task.dueDate || !isIsoDate(task.dueDate)) return false;
  return task.dueDate < todayIn(timeZone, now);
}

/** One task may produce both an academic deadline and a personal work block. */
export function taskToCalendarEntries(
  task: Task,
  timeZone: string,
  now: Date = new Date(),
): Array<TaskDeadlineCalendarEntry | TaskScheduleCalendarEntry> {
  const entries: Array<TaskDeadlineCalendarEntry | TaskScheduleCalendarEntry> = [];
  const overdue = isTaskOverdue(task, now, timeZone);
  const course = taskCourse(task);

  if (task.dueAt && isIsoInstant(task.dueAt)) {
    entries.push({
      key: `task-deadline:${task.id}`,
      kind: "task_deadline",
      title: task.title,
      date: todayIn(timeZone, new Date(task.dueAt)),
      start: new Date(task.dueAt).toISOString(),
      end: null,
      allDay: false,
      ...course,
      task,
      duePrecision: "instant",
      overdue,
      issues: task.dueDate && !isIsoDate(task.dueDate) ? ["invalid_deadline"] : [],
    });
  } else if (task.dueDate && isIsoDate(task.dueDate)) {
    entries.push({
      key: `task-deadline:${task.id}`,
      kind: "task_deadline",
      title: task.title,
      date: task.dueDate,
      start: null,
      end: null,
      allDay: true,
      ...course,
      task,
      duePrecision: "date",
      overdue,
      issues: task.dueAt ? ["invalid_deadline"] : [],
    });
  }

  if (task.scheduledStart && isIsoInstant(task.scheduledStart)) {
    const start = new Date(task.scheduledStart).toISOString();
    const issues: CalendarDataIssue[] = [];
    let end: string | null = null;

    if (task.scheduledEnd) {
      if (!isIsoInstant(task.scheduledEnd)) {
        issues.push("invalid_schedule_end");
      } else if (Date.parse(task.scheduledEnd) < Date.parse(start)) {
        issues.push("schedule_end_before_start");
      } else {
        end = new Date(task.scheduledEnd).toISOString();
      }
    }

    entries.push({
      key: `task-schedule:${task.id}`,
      kind: "task_schedule",
      title: task.title,
      date: todayIn(timeZone, new Date(start)),
      start,
      end,
      allDay: false,
      ...course,
      task,
      overdue,
      issues,
    });
  }

  return entries;
}

export function workSessionToCalendarEntry(
  workSession: WorkSession,
  task: Task,
  timeZone: string,
  now: Date = new Date(),
): TaskWorkSessionCalendarEntry | null {
  if (
    workSession.taskId !== task.id
    || workSession.status === "cancelled"
    || !isIsoInstant(workSession.startsAt)
    || !isIsoInstant(workSession.endsAt)
    || Date.parse(workSession.endsAt) <= Date.parse(workSession.startsAt)
  ) {
    return null;
  }

  const start = new Date(workSession.startsAt).toISOString();
  return {
    key: `task-work-session:${workSession.id}`,
    kind: "task_work_session",
    title: task.title,
    date: todayIn(timeZone, new Date(start)),
    start,
    end: new Date(workSession.endsAt).toISOString(),
    allDay: false,
    ...taskCourse(task),
    task,
    workSession,
    overdue: isTaskOverdue(task, now, timeZone),
    issues: [],
  };
}

export function calendarEventToEntry(
  event: CalendarEvent,
  timeZone: string,
): NativeCalendarEntry | null {
  if (!isIsoInstant(event.start) || !isIsoInstant(event.end)) return null;
  if (Date.parse(event.end) <= Date.parse(event.start)) return null;

  return {
    key: `event:${event.id}`,
    kind: "calendar_event",
    title: event.title,
    date: todayIn(timeZone, new Date(event.start)),
    start: new Date(event.start).toISOString(),
    end: new Date(event.end).toISOString(),
    allDay: event.allDay,
    courseKey: event.course,
    courseLabel: event.course,
    courseColor: null,
    event,
    issues: [],
  };
}

export function externalCalendarEventToEntry(
  event: ExternalCalendarProjection,
  timeZone: string,
): ExternalCalendarEntry | null {
  if (
    event.status === "cancelled"
    || !isIsoInstant(event.startsAt)
    || !isIsoInstant(event.endsAt)
    || Date.parse(event.endsAt) <= Date.parse(event.startsAt)
  ) {
    return null;
  }
  const start = new Date(event.startsAt).toISOString();
  return {
    key: `external-calendar-event:${event.provider}:${event.externalCalendarId}:${event.externalEventId}`,
    kind: "external_calendar_event",
    title: event.title,
    date: todayIn(timeZone, new Date(start)),
    start,
    end: new Date(event.endsAt).toISOString(),
    allDay: event.allDay,
    courseKey: event.courseId ?? event.courseCode ?? null,
    courseLabel: event.courseCode ?? null,
    courseColor: event.courseColor ?? null,
    externalEvent: event,
    issues: [],
  };
}

const wallTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function weekdayFor(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Expand a weekly course recurrence into timezone-safe occurrence entries. */
export function courseMeetingToCalendarEntries(
  meeting: CourseMeeting,
  fromDate: string,
  toDateExclusive: string,
  displayTimeZone: string,
): CourseMeetingCalendarEntry[] {
  if (
    !isIsoDate(fromDate) ||
    !isIsoDate(toDateExclusive) ||
    fromDate >= toDateExclusive ||
    !isIsoDate(meeting.startDate) ||
    (meeting.endDateExclusive !== null && !isIsoDate(meeting.endDateExclusive)) ||
    !wallTimePattern.test(meeting.startTime) ||
    !wallTimePattern.test(meeting.endTime) ||
    !isValidTimeZone(meeting.timeZone)
  ) {
    return [];
  }

  const first = fromDate > meeting.startDate ? fromDate : meeting.startDate;
  const last = meeting.endDateExclusive && meeting.endDateExclusive < toDateExclusive
    ? meeting.endDateExclusive
    : toDateExclusive;
  const weekdays = new Set<number>(meeting.weekdays);
  const entries: CourseMeetingCalendarEntry[] = [];

  for (let date = first; date < last; date = addDays(date, 1)) {
    if (!weekdays.has(weekdayFor(date))) continue;

    const endDate = meeting.endTime > meeting.startTime ? date : addDays(date, 1);
    try {
      const start = fromZonedInputValue(`${date}T${meeting.startTime}`, meeting.timeZone);
      const end = fromZonedInputValue(`${endDate}T${meeting.endTime}`, meeting.timeZone);
      entries.push({
        key: `course-meeting:${meeting.id}:${date}`,
        kind: "course_meeting",
        title: meeting.title,
        date: todayIn(displayTimeZone, new Date(start)),
        start,
        end,
        allDay: false,
        courseKey: meeting.course.id,
        courseLabel: meeting.course.label,
        courseColor: meeting.course.color,
        meeting,
        occurrenceDate: date,
        issues: [],
      });
    } catch {
      // A DST gap can invalidate one occurrence without dropping the series.
    }
  }

  return entries;
}

/** Convert an active assessment prediction into a calendar projection. */
export function predictionToCalendarEntry(
  prediction: {
    id: string;
    courseId: string;
    courseCode?: string;
    courseName?: string;
    courseColor?: string;
    title: string;
    predictionType: string;
    predictedDate: string;
    predictedTime: string | null;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    status: string;
    rationale: string;
    sourceReference: string | null;
  },
  timeZone: string,
): AssessmentPredictionCalendarEntry | null {
  if (prediction.status !== "active") return null;
  if (prediction.confidence !== "HIGH" && prediction.confidence !== "MEDIUM") return null;

  const date = prediction.predictedDate;
  const start = prediction.predictedTime
    ? fromZonedInputValue(`${date}T${prediction.predictedTime}`, timeZone)
    : `${date}T00:00:00Z`;
  const end = prediction.predictedTime
    ? fromZonedInputValue(`${date}T${prediction.predictedTime}`, timeZone)
    : `${date}T23:59:59Z`;

  return {
    key: `assessment-prediction:${prediction.id}`,
    kind: "assessment_prediction",
    title: `◇ Possible ${prediction.title}`,
    date,
    start,
    end,
    allDay: !prediction.predictedTime,
    courseKey: prediction.courseId,
    courseLabel: prediction.courseCode ?? null,
    courseColor: prediction.courseColor ?? null,
    prediction: {
      id: prediction.id,
      courseId: prediction.courseId,
      title: prediction.title,
      predictionType: prediction.predictionType,
      predictedDate: prediction.predictedDate,
      predictedTime: prediction.predictedTime,
      confidence: prediction.confidence,
      rationale: prediction.rationale,
      sourceReference: prediction.sourceReference,
    },
    issues: [],
  };
}

function taskStatusFor(entry: CalendarEntry): Task["status"] | null {
  return entry.kind === "task_deadline" || entry.kind === "task_schedule" || entry.kind === "task_work_session"
    ? entry.task.status
    : null;
}

export function matchesCalendarFilters(
  entry: CalendarEntry,
  filters: CalendarFilters = defaultCalendarFilters,
): boolean {
  if (entry.kind === "calendar_event" && !filters.showCalendarEvents) return false;
  if (entry.kind === "external_calendar_event" && !filters.showCalendarEvents) return false;
  if (entry.kind === "course_meeting" && !filters.showCourseMeetings) return false;
  if (entry.kind === "assessment_prediction" && !filters.showPredictions) return false;
  if ((entry.kind === "task_deadline" || entry.kind === "task_schedule" || entry.kind === "task_work_session") && !filters.showTasks) {
    return false;
  }
  if (entry.kind === "task_deadline" && !filters.showDeadlines) return false;
  if ((entry.kind === "task_schedule" || entry.kind === "task_work_session") && !filters.showScheduled) return false;
  if (entry.allDay && !filters.showAllDay) return false;

  const status = taskStatusFor(entry);
  if (status === "completed" && !filters.showDone) return false;
  if (status === "submitted" && !filters.showSubmitted) return false;
  if (status === "cancelled") return false;

  return filters.courseKeys.length === 0 || (
    entry.courseKey !== null && filters.courseKeys.includes(entry.courseKey)
  );
}

export function filterCalendarEntries(
  entries: readonly CalendarEntry[],
  filters: CalendarFilters = defaultCalendarFilters,
): CalendarEntry[] {
  return entries.filter((entry) => matchesCalendarFilters(entry, filters));
}

export type TaskRescheduleRequest =
  | { kind: "move_deadline"; toDate: string; timeZone: string }
  | { kind: "move_schedule"; toStart: string };

export class CalendarRescheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarRescheduleError";
  }
}

/**
 * Return the minimal persistence patch for a drag. Deadline drags never touch
 * personal scheduling, and schedule drags never touch the academic deadline.
 */
export function rescheduleTask(task: Task, request: TaskRescheduleRequest): TaskPatch {
  if (request.kind === "move_deadline") {
    if (!isIsoDate(request.toDate)) {
      throw new CalendarRescheduleError("Choose a valid deadline date.");
    }
    if (!isValidTimeZone(request.timeZone)) {
      throw new CalendarRescheduleError("Choose a valid time zone.");
    }
    if (!task.dueAt) return { dueDate: request.toDate };
    if (!isIsoInstant(task.dueAt)) {
      throw new CalendarRescheduleError("The existing due time is invalid.");
    }

    const time = toZonedInputValue(task.dueAt, request.timeZone).slice(11);
    return {
      dueDate: request.toDate,
      dueAt: fromZonedInputValue(`${request.toDate}T${time}`, request.timeZone),
    };
  }

  if (!task.scheduledStart || !isIsoInstant(task.scheduledStart)) {
    throw new CalendarRescheduleError("Only an already scheduled task can move to a new time.");
  }
  if (!isIsoInstant(request.toStart)) {
    throw new CalendarRescheduleError("Choose a valid scheduled time.");
  }

  const scheduledStart = new Date(request.toStart).toISOString();
  if (!task.scheduledEnd) return { scheduledStart, scheduledEnd: null };
  if (!isIsoInstant(task.scheduledEnd) || Date.parse(task.scheduledEnd) < Date.parse(task.scheduledStart)) {
    throw new CalendarRescheduleError("The existing scheduled interval is invalid.");
  }

  const duration = Date.parse(task.scheduledEnd) - Date.parse(task.scheduledStart);
  return {
    scheduledStart,
    scheduledEnd: new Date(Date.parse(scheduledStart) + duration).toISOString(),
  };
}
