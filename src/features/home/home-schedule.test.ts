import { describe, expect, it } from "vitest";

import {
  buildCalendarItems,
  sortCalendarItemsChronologically,
} from "@/features/calendar/calendar-items";
import {
  formatScheduleTiming,
  scheduleItemMeta,
  scheduleItemTitle,
} from "@/features/home/home-schedule";
import type { CalendarEvent } from "@/types/calendar-event";
import type { CourseMeeting } from "@/types/course-meeting";
import type { ExternalCalendarProjection } from "@/types/external-calendar";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

const TIMEZONE = "Asia/Manila";

function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Finish problem set",
    description: null,
    status: "todo",
    priority: "high",
    dueDate: "2026-08-29",
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: null,
    course: "CS 201",
    parentTaskId: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function mockNativeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Advising Session",
    description: "Office hours check-in",
    start: "2026-08-29T06:00:00.000Z", // 14:00 Manila
    end: "2026-08-29T07:00:00.000Z",   // 15:00 Manila
    allDay: false,
    eventType: "academic",
    source: "life_os",
    externalId: null,
    sourceUrl: null,
    course: "CS 201",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function mockExternalEvent(
  overrides: Partial<ExternalCalendarProjection> = {},
): ExternalCalendarProjection {
  return {
    id: "ext-row-1",
    provider: "google",
    calendarId: "cal-1",
    externalCalendarId: "primary@gmail.com",
    calendarName: "Personal",
    access: "read_only",
    externalEventId: "google-evt-1",
    revision: "rev-1",
    title: "Dentist Appointment",
    startsAt: "2026-08-29T02:00:00.000Z", // 10:00 Manila
    endsAt: "2026-08-29T03:00:00.000Z",   // 11:00 Manila
    allDay: false,
    status: "confirmed",
    ...overrides,
  };
}

function mockCourseMeeting(
  overrides: Partial<CourseMeeting> = {},
): CourseMeeting {
  return {
    id: "meeting-1",
    title: "Algorithms Lecture",
    course: {
      id: "course-1",
      label: "CS 201 · Algorithms",
      color: "oklch(60% 0.2 250)",
    },
    weekdays: [6], // Saturday (2026-08-29 is Saturday)
    startDate: "2026-08-01",
    endDateExclusive: "2026-12-31",
    startTime: "08:30",
    endTime: "10:00",
    timeZone: TIMEZONE,
    ...overrides,
  };
}

function mockWorkSession(
  overrides: Partial<WorkSession> = {},
): WorkSession {
  return {
    id: "session-1",
    taskId: "task-1",
    startsAt: "2026-08-29T05:00:00.000Z", // 13:00 Manila
    endsAt: "2026-08-29T06:00:00.000Z",   // 14:00 Manila
    status: "planned",
    source: "manual",
    completedAt: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("Home Schedule Projection & Ordering", () => {
  it("sorts all-day items before timed items and orders timed items chronologically", () => {
    const allDayEvent = mockNativeEvent({
      id: "event-allday",
      title: "Reading Day",
      allDay: true,
      start: "2026-08-28T16:00:00.000Z", // 2026-08-29 in Manila
      end: "2026-08-29T16:00:00.000Z",
    });

    const earlyMeeting = mockCourseMeeting(); // 08:30 – 10:00 Manila
    const midExternal = mockExternalEvent(); // 10:00 – 11:00 Manila
    const afternoonTask = mockTask({
      id: "task-scheduled",
      title: "Study session",
      scheduledStart: "2026-08-29T07:00:00.000Z", // 15:00 Manila
      scheduledEnd: "2026-08-29T08:00:00.000Z",   // 16:00 Manila
    });
    const workSession = mockWorkSession(); // 13:00 – 14:00 Manila
    const lateEvent = mockNativeEvent({
      id: "event-late",
      title: "Evening check-in",
      start: "2026-08-29T10:00:00.000Z", // 18:00 Manila
      end: "2026-08-29T11:00:00.000Z",   // 19:00 Manila
    });

    const items = buildCalendarItems(
      [allDayEvent, lateEvent],
      [afternoonTask],
      [], // Exclude deadline tasks
      TIMEZONE,
      [earlyMeeting],
      "2026-08-29",
      "2026-08-30",
      [workSession],
      [mockTask()],
      [midExternal],
    ).filter((item) => item.date === "2026-08-29");

    const sorted = sortCalendarItemsChronologically(items);

    expect(sorted.map((item) => scheduleItemTitle(item))).toEqual([
      "Reading Day",          // All-day
      "Algorithms Lecture",   // 08:30
      "Dentist Appointment",  // 10:00
      "Finish problem set",   // 13:00 (work session)
      "Study session",        // 15:00 (scheduled task)
      "Evening check-in",     // 18:00
    ]);
  });

  it("handles tie-breaking with equal start times by earlier end time, then rank", () => {
    const longSession: WorkSession = mockWorkSession({
      id: "session-long",
      startsAt: "2026-08-29T01:00:00.000Z",
      endsAt: "2026-08-29T03:00:00.000Z",
    });
    const shortSession: WorkSession = mockWorkSession({
      id: "session-short",
      startsAt: "2026-08-29T01:00:00.000Z",
      endsAt: "2026-08-29T02:00:00.000Z",
    });

    const items = buildCalendarItems(
      [],
      [],
      [],
      TIMEZONE,
      [],
      "2026-08-29",
      "2026-08-30",
      [longSession, shortSession],
      [mockTask()],
      [],
    );

    const sorted = sortCalendarItemsChronologically(items);
    expect(sorted[0].entry.end).toBe("2026-08-29T02:00:00.000Z");
    expect(sorted[1].entry.end).toBe("2026-08-29T03:00:00.000Z");
  });

  it("does not project task deadlines when deadlineTasks is empty", () => {
    const taskWithDeadline = mockTask({
      dueDate: "2026-08-29",
      dueAt: "2026-08-29T15:59:00.000Z",
      scheduledStart: null,
    });

    const items = buildCalendarItems(
      [],
      [],
      [], // Empty deadline tasks
      TIMEZONE,
      [],
      "2026-08-29",
      "2026-08-30",
      [],
      [taskWithDeadline],
      [],
    );

    expect(items.filter((item) => item.kind === "deadline")).toHaveLength(0);
    expect(items).toHaveLength(0);
  });

  it("formats schedule timing and metadata accurately across all item kinds", () => {
    const items = buildCalendarItems(
      [mockNativeEvent()],
      [mockTask({ scheduledStart: "2026-08-29T01:00:00.000Z", scheduledEnd: "2026-08-29T02:00:00.000Z" })],
      [],
      TIMEZONE,
      [mockCourseMeeting()],
      "2026-08-29",
      "2026-08-30",
      [mockWorkSession()],
      [mockTask()],
      [mockExternalEvent()],
    );

    const meetingItem = items.find((i) => i.kind === "course_meeting")!;
    const eventItem = items.find((i) => i.kind === "event")!;
    const extItem = items.find((i) => i.kind === "external_event")!;
    const workSessionItem = items.find((i) => i.kind === "work_session")!;
    const scheduledTaskItem = items.find((i) => i.kind === "scheduled_task")!;

    expect(scheduleItemTitle(meetingItem)).toBe("Algorithms Lecture");
    expect(scheduleItemMeta(meetingItem)).toContain("CS 201 · Algorithms");
    expect(formatScheduleTiming(meetingItem, TIMEZONE)).toBe("8:30 AM – 10:00 AM");

    expect(scheduleItemTitle(eventItem)).toBe("Advising Session");
    expect(scheduleItemMeta(eventItem)).toBe("CS 201");
    expect(formatScheduleTiming(eventItem, TIMEZONE)).toBe("2:00 PM – 3:00 PM");

    expect(scheduleItemTitle(extItem)).toBe("Dentist Appointment");
    expect(scheduleItemMeta(extItem)).toBe("Personal (Google Calendar)");
    expect(formatScheduleTiming(extItem, TIMEZONE)).toBe("10:00 AM – 11:00 AM");

    expect(scheduleItemTitle(workSessionItem)).toBe("Finish problem set");
    expect(scheduleItemMeta(workSessionItem)).toContain("CS 201 · Work session");
    expect(formatScheduleTiming(workSessionItem, TIMEZONE)).toBe("1:00 PM – 2:00 PM");

    expect(scheduleItemTitle(scheduledTaskItem)).toBe("Finish problem set");
    expect(scheduleItemMeta(scheduledTaskItem)).toContain("CS 201 · Scheduled task");
    expect(formatScheduleTiming(scheduledTaskItem, TIMEZONE)).toBe("9:00 AM – 10:00 AM");
  });
});
