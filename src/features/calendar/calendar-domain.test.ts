import { describe, expect, it } from "vitest";

import type { CourseMeeting } from "@/types/course-meeting";
import type { ExternalCalendarProjection } from "@/types/external-calendar";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

import {
  CalendarRescheduleError,
  courseMeetingToCalendarEntries,
  defaultCalendarFilters,
  externalCalendarEventToEntry,
  filterCalendarEntries,
  isTaskOverdue,
  rescheduleTask,
  taskToCalendarEntries,
  workSessionToCalendarEntry,
} from "./calendar-domain";
import {
  buildCalendarItems,
  sortCalendarItemsChronologically,
} from "./calendar-items";

const MANILA = "Asia/Manila";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Write paper",
    description: null,
    status: "todo",
    priority: "none",
    dueDate: null,
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: null,
    course: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("task calendar projection", () => {
  it("maps a due-date-only task to an all-day deadline without inventing a time", () => {
    const [entry] = taskToCalendarEntries(task({ dueDate: "2026-08-28" }), MANILA);
    expect(entry).toMatchObject({
      kind: "task_deadline",
      date: "2026-08-28",
      allDay: true,
      start: null,
      duePrecision: "date",
    });
  });

  it("maps an exact deadline as a timed marker near midnight", () => {
    const [entry] = taskToCalendarEntries(
      task({ dueDate: "2026-08-28", dueAt: "2026-08-27T16:15:00.000Z" }),
      MANILA,
    );
    expect(entry).toMatchObject({
      kind: "task_deadline",
      date: "2026-08-28",
      allDay: false,
      start: "2026-08-27T16:15:00.000Z",
      duePrecision: "instant",
    });
  });

  it("maps a scheduled task and preserves its explicit interval", () => {
    const [entry] = taskToCalendarEntries(
      task({
        scheduledStart: "2026-08-28T01:00:00.000Z",
        scheduledEnd: "2026-08-28T02:30:00.000Z",
      }),
      MANILA,
    );
    expect(entry).toMatchObject({
      kind: "task_schedule",
      date: "2026-08-28",
      allDay: false,
      start: "2026-08-28T01:00:00.000Z",
      end: "2026-08-28T02:30:00.000Z",
    });
  });

  it("projects both a deadline and a work block when both exist", () => {
    const entries = taskToCalendarEntries(
      task({ dueDate: "2026-08-30", scheduledStart: "2026-08-28T01:00:00.000Z" }),
      MANILA,
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["task_deadline", "task_schedule"]);
  });

  it("projects multiple task-owned work sessions without changing the deadline", () => {
    const sourceTask = task({ dueDate: "2026-08-30" });
    const workSession: WorkSession = {
      id: "session-1",
      taskId: sourceTask.id,
      startsAt: "2026-08-28T01:00:00.000Z",
      endsAt: "2026-08-28T02:30:00.000Z",
      status: "planned",
      source: "manual",
      completedAt: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };

    expect(workSessionToCalendarEntry(workSession, sourceTask, MANILA)).toMatchObject({
      kind: "task_work_session",
      task: { id: sourceTask.id, dueDate: "2026-08-30" },
      workSession: { id: "session-1" },
      start: workSession.startsAt,
      end: workSession.endsAt,
    });
    expect(buildCalendarItems(
      [],
      [],
      [sourceTask],
      MANILA,
      [],
      undefined,
      undefined,
      [workSession],
      [sourceTask],
    ).map((item) => item.kind)).toEqual(["work_session", "deadline"]);
  });

  it("builds both in-range presentations once and hides Done by default", () => {
    const both = task({ dueDate: "2026-08-30", scheduledStart: "2026-08-28T01:00:00.000Z" });
    const done = task({ id: "done", status: "completed", dueDate: "2026-08-30" });
    const items = buildCalendarItems([], [both], [both, done], MANILA);
    expect(items.map((item) => item.kind)).toEqual(["scheduled_task", "deadline"]);
  });

  it("drops missing or unusable signals while retaining a valid date fallback", () => {
    expect(taskToCalendarEntries(task(), MANILA)).toEqual([]);
    expect(taskToCalendarEntries(task({ dueDate: "2026-02-30" }), MANILA)).toEqual([]);
    const [fallback] = taskToCalendarEntries(
      task({ dueDate: "2026-08-28", dueAt: "not-an-instant" }),
      MANILA,
    );
    expect(fallback).toMatchObject({ allDay: true, issues: ["invalid_deadline"] });
  });
});

describe("external calendar projection", () => {
  it("keeps a provider event fixed and source-aware", () => {
    const event: ExternalCalendarProjection = {
      id: "mirror-1",
      provider: "google",
      calendarId: "calendar-1",
      externalCalendarId: "primary",
      calendarName: "Personal",
      access: "read_only",
      externalEventId: "provider-event-1",
      revision: "etag-1",
      title: "Dentist",
      startsAt: "2026-08-28T01:00:00.000Z",
      endsAt: "2026-08-28T02:00:00.000Z",
      allDay: false,
      status: "confirmed",
    };

    expect(externalCalendarEventToEntry(event, MANILA)).toMatchObject({
      kind: "external_calendar_event",
      title: "Dentist",
      externalEvent: {
        provider: "google",
        externalEventId: "provider-event-1",
        access: "read_only",
      },
    });
  });
});

describe("completion, submission, filtering, and overdue rules", () => {
  const now = new Date("2026-08-28T04:00:00.000Z");

  it("marks a date-only task overdue only after its Manila due day", () => {
    expect(isTaskOverdue(task({ dueDate: "2026-08-27" }), now, MANILA)).toBe(true);
    expect(isTaskOverdue(task({ dueDate: "2026-08-28" }), now, MANILA)).toBe(false);
  });

  it("uses the exact instant when a due time exists", () => {
    expect(isTaskOverdue(task({ dueDate: "2026-08-28", dueAt: "2026-08-28T03:59:59Z" }), now, MANILA)).toBe(true);
    expect(isTaskOverdue(task({ dueDate: "2026-08-28", dueAt: "2026-08-28T04:00:00Z" }), now, MANILA)).toBe(false);
  });

  it("never calls Submitted or Done overdue and filters them independently", () => {
    const submitted = task({ id: "submitted", status: "submitted", dueDate: "2026-08-20" });
    const done = task({ id: "done", status: "completed", dueDate: "2026-08-20" });
    expect(isTaskOverdue(submitted, now, MANILA)).toBe(false);
    expect(isTaskOverdue(done, now, MANILA)).toBe(false);

    const entries = [
      ...taskToCalendarEntries(submitted, MANILA, now),
      ...taskToCalendarEntries(done, MANILA, now),
    ];
    expect(filterCalendarEntries(entries).map((entry) => "task" in entry ? entry.task.id : "")).toEqual(["submitted"]);
    expect(filterCalendarEntries(entries, { ...defaultCalendarFilters, showSubmitted: false })).toEqual([]);
    expect(filterCalendarEntries(entries, { ...defaultCalendarFilters, showDone: true }).map((entry) => "task" in entry ? entry.task.id : "")).toEqual([
      "submitted",
      "done",
    ]);
  });
});

describe("task rescheduling", () => {
  it("moves an all-day deadline without changing or creating a schedule", () => {
    const original = task({
      dueDate: "2026-08-28",
      scheduledStart: "2026-08-27T01:00:00.000Z",
    });
    expect(rescheduleTask(original, { kind: "move_deadline", toDate: "2026-08-30", timeZone: MANILA })).toEqual({
      dueDate: "2026-08-30",
    });
  });

  it("moves a timed deadline to another date while preserving its Manila clock time", () => {
    const original = task({ dueDate: "2026-08-28", dueAt: "2026-08-28T06:30:00.000Z" });
    expect(rescheduleTask(original, { kind: "move_deadline", toDate: "2026-08-30", timeZone: MANILA })).toEqual({
      dueDate: "2026-08-30",
      dueAt: "2026-08-30T06:30:00.000Z",
    });
  });

  it("moves a scheduled task and preserves duration without touching its deadline", () => {
    const original = task({
      dueDate: "2026-08-30",
      scheduledStart: "2026-08-28T01:00:00.000Z",
      scheduledEnd: "2026-08-28T02:30:00.000Z",
    });
    expect(rescheduleTask(original, { kind: "move_schedule", toStart: "2026-08-29T04:00:00+08:00" })).toEqual({
      scheduledStart: "2026-08-28T20:00:00.000Z",
      scheduledEnd: "2026-08-28T21:30:00.000Z",
    });
  });

  it("does not convert an unscheduled deadline into a work block", () => {
    expect(() => rescheduleTask(task({ dueDate: "2026-08-28" }), {
      kind: "move_schedule",
      toStart: "2026-08-29T04:00:00Z",
    })).toThrow(CalendarRescheduleError);
  });
});

describe("course meetings", () => {
  it("expands recurring meetings with identity, color, and timezone-safe instants", () => {
    const meeting: CourseMeeting = {
      id: "meeting-1",
      title: "Algorithms",
      course: { id: "cs-201", label: "CS 201", color: "var(--course-cs-201)" },
      weekdays: [1, 3],
      startDate: "2026-08-24",
      endDateExclusive: "2026-09-01",
      startTime: "09:00",
      endTime: "10:30",
      timeZone: MANILA,
    };

    const entries = courseMeetingToCalendarEntries(
      meeting,
      "2026-08-24",
      "2026-08-31",
      MANILA,
    );
    expect(entries.map((entry) => entry.occurrenceDate)).toEqual(["2026-08-24", "2026-08-26"]);
    expect(entries[0]).toMatchObject({
      kind: "course_meeting",
      start: "2026-08-24T01:00:00.000Z",
      end: "2026-08-24T02:30:00.000Z",
      courseKey: "cs-201",
      courseColor: "var(--course-cs-201)",
    });
    expect(filterCalendarEntries(entries, {
      ...defaultCalendarFilters,
      courseKeys: ["another-course"],
    })).toEqual([]);
  });

  describe("sortCalendarItemsChronologically", () => {
    it("orders all-day entries before timed entries and sorts timed entries by start time", () => {
      const items = buildCalendarItems(
        [
          {
            id: "event-allday",
            title: "Holiday",
            description: null,
            start: "2026-08-28T16:00:00.000Z",
            end: "2026-08-29T16:00:00.000Z",
            allDay: true,
            eventType: "general",
            source: "life_os",
            externalId: null,
            sourceUrl: null,
            course: null,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
          {
            id: "event-timed",
            title: "Lab Session",
            description: null,
            start: "2026-08-29T06:00:00.000Z",
            end: "2026-08-29T08:00:00.000Z",
            allDay: false,
            eventType: "academic",
            source: "life_os",
            externalId: null,
            sourceUrl: null,
            course: null,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
        [
          task({
            id: "task-early",
            title: "Morning Review",
            scheduledStart: "2026-08-29T01:00:00.000Z",
            scheduledEnd: "2026-08-29T02:00:00.000Z",
          }),
        ],
        [],
        MANILA,
        [],
        "2026-08-29",
        "2026-08-30",
        [],
        [],
        [],
      ).filter((item) => item.date === "2026-08-29");

      const sorted = sortCalendarItemsChronologically(items);
      expect(sorted.map((item) => item.entry.title)).toEqual([
        "Holiday",
        "Morning Review",
        "Lab Session",
      ]);
    });
  });

  describe("Blackboard external event calendar projection", () => {
    const blackboardProjection: ExternalCalendarProjection = {
      id: "rec-bb-1",
      provider: "blackboard",
      calendarId: "acc-1",
      externalCalendarId: "CS101",
      calendarName: "Blackboard",
      access: "read_only",
      externalEventId: "item-bb-1",
      revision: "rev1",
      title: "Problem Set 1",
      startsAt: "2026-08-29T14:00:00.000Z",
      endsAt: "2026-08-29T15:00:00.000Z",
      allDay: false,
      status: "confirmed",
      courseCode: "CS101",
      courseId: "course-uuid-cs101",
      courseColor: "#2563eb",
    };

    it("converts Blackboard external calendar projection to ExternalCalendarEntry with course metadata", () => {
      const entry = externalCalendarEventToEntry(blackboardProjection, MANILA);
      expect(entry).not.toBeNull();
      expect(entry).toMatchObject({
        key: "external-calendar-event:blackboard:CS101:item-bb-1",
        kind: "external_calendar_event",
        title: "Problem Set 1",
        date: "2026-08-29",
        courseKey: "course-uuid-cs101",
        courseLabel: "CS101",
        courseColor: "#2563eb",
        allDay: false,
      });
    });

    it("projects Blackboard external event into buildCalendarItems as an external_event", () => {
      const items = buildCalendarItems(
        [],
        [],
        [],
        MANILA,
        [],
        "2026-08-29",
        "2026-08-30",
        [],
        [],
        [blackboardProjection],
      );

      expect(items).toHaveLength(1);
      const [item] = items;
      expect(item.kind).toBe("external_event");
      expect(item.date).toBe("2026-08-29");
      expect(item.key).toBe("external-calendar-event:blackboard:CS101:item-bb-1:2026-08-29");
      if (item.kind === "external_event") {
        expect(item.externalEvent.provider).toBe("blackboard");
        expect(item.entry.courseLabel).toBe("CS101");
      }
    });

    it("does not create duplicate CalendarItems upon repeated sync or projection", () => {
      const items = buildCalendarItems(
        [],
        [],
        [],
        MANILA,
        [],
        "2026-08-29",
        "2026-08-30",
        [],
        [],
        [blackboardProjection, blackboardProjection], // duplicate in array
      );

      // Distinct keys in occupied dates
      const keys = items.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("filters Blackboard events by courseKeys filter", () => {
      const entry = externalCalendarEventToEntry(blackboardProjection, MANILA)!;

      // Matching course filter
      expect(
        filterCalendarEntries([entry], {
          ...defaultCalendarFilters,
          courseKeys: ["course-uuid-cs101"],
        }),
      ).toHaveLength(1);

      // Non-matching course filter
      expect(
        filterCalendarEntries([entry], {
          ...defaultCalendarFilters,
          courseKeys: ["other-course"],
        }),
      ).toHaveLength(0);
    });

    it("coexists seamlessly with generic external events, native events, tasks, course meetings, and work sessions", () => {
      const googleEvent: ExternalCalendarProjection = {
        id: "rec-gcal-1",
        provider: "google",
        calendarId: "primary",
        externalCalendarId: "primary",
        calendarName: "Google Personal",
        access: "read_only",
        externalEventId: "gcal-evt-1",
        revision: "etag1",
        title: "Dentist Appointment",
        startsAt: "2026-08-29T02:00:00.000Z",
        endsAt: "2026-08-29T03:00:00.000Z",
        allDay: false,
        status: "confirmed",
      };

      const nativeTask = task({
        id: "task-homework",
        title: "Finish Math HW",
        dueDate: "2026-08-29",
      });

      const items = buildCalendarItems(
        [],
        [],
        [nativeTask],
        MANILA,
        [],
        "2026-08-29",
        "2026-08-30",
        [],
        [],
        [blackboardProjection, googleEvent],
      );

      expect(items).toHaveLength(3);
      const kinds = items.map((i) => i.kind);
      expect(kinds).toContain("external_event");
      expect(kinds).toContain("deadline");

      const externalProviders = items
        .filter((i): i is Extract<typeof i, { kind: "external_event" }> => i.kind === "external_event")
        .map((i) => i.externalEvent.provider);
      expect(externalProviders).toContain("blackboard");
      expect(externalProviders).toContain("google");
    });
  });
});

