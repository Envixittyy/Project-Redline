import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";
import type { CourseMeeting } from "@/types/course-meeting";
import type { CalendarEvent } from "@/types/calendar-event";
import type { ExternalCalendarProjection } from "@/types/external-calendar";

import {
  buildFocusReadModel,
  orderTasksForFocus,
} from "./focus-domain";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Review Chemistry Problem Set",
    description: null,
    status: "todo",
    priority: "high",
    dueDate: "2026-08-29",
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: null,
    course: "CHEM 101",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function makeWorkSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: "session-1",
    taskId: "task-1",
    startsAt: "2026-08-29T10:00:00.000Z",
    endsAt: "2026-08-29T11:00:00.000Z",
    source: "planner",
    status: "planned",
    completedAt: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("Phase 6A: Focus Presentation / Read-Model Domain", () => {
  const timeZone = "Asia/Manila";
  const todayDate = "2026-08-29";

  it("1. selects current active work session as NOW", () => {
    const task = makeTask({ id: "task-active", title: "Active Coding Session" });
    const session = makeWorkSession({
      id: "ws-active",
      taskId: "task-active",
      startsAt: "2026-08-29T09:00:00.000Z",
      endsAt: "2026-08-29T10:30:00.000Z",
    });

    const workSessionItem: CalendarItem = {
      key: "task-work-session:ws-active:2026-08-29",
      kind: "work_session",
      date: todayDate,
      task,
      workSession: session,
      entry: {
        key: "task-work-session:ws-active",
        kind: "task_work_session",
        title: task.title,
        date: todayDate,
        start: session.startsAt,
        end: session.endsAt,
        allDay: false,
        courseKey: null,
        courseLabel: null,
        courseColor: null,
        task,
        workSession: session,
        overdue: false,
        issues: [],
      },
    };

    const nowIso = "2026-08-29T09:45:00.000Z";
    const result = buildFocusReadModel({
      tasks: [task],
      scheduleItems: [workSessionItem],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("active_work_session");
    if (result.now.kind === "active_work_session") {
      expect(result.now.title).toBe("Active Coding Session");
      expect(result.now.remainingMinutes).toBe(45);
      expect(result.now.totalDurationMinutes).toBe(90);
      expect(result.now.task.id).toBe("task-active");
    }
  });

  it("2. selects current fixed commitment (course meeting / calendar event) as NOW", () => {
    const meeting: CourseMeeting = {
      id: "meeting-1",
      title: "Algorithms Lecture",
      weekdays: [6],
      startTime: "13:00",
      endTime: "14:30",
      timeZone,
      startDate: "2026-08-01",
      endDateExclusive: null,
      course: { id: "course-1", label: "Algorithms", color: "#3b82f6" },
    };

    const meetingItem: CalendarItem = {
      key: "course-meeting:meeting-1:2026-08-29",
      kind: "course_meeting",
      date: todayDate,
      meeting,
      entry: {
        key: "course-meeting:meeting-1:2026-08-29",
        kind: "course_meeting",
        title: "Algorithms Lecture",
        date: todayDate,
        start: "2026-08-29T05:00:00.000Z", // 13:00 Manila (UTC+8)
        end: "2026-08-29T06:30:00.000Z", // 14:30 Manila
        allDay: false,
        courseKey: "course-1",
        courseLabel: "Algorithms",
        courseColor: "#3b82f6",
        meeting,
        occurrenceDate: todayDate,
        issues: [],
      },
    };

    const nowIso = "2026-08-29T05:30:00.000Z";
    const result = buildFocusReadModel({
      tasks: [],
      scheduleItems: [meetingItem],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("active_commitment");
    if (result.now.kind === "active_commitment") {
      expect(result.now.title).toBe("Algorithms Lecture");
      expect(result.now.source).toBe("course_meeting");
      expect(result.now.remainingMinutes).toBe(60);
      expect(result.now.color).toBe("#3b82f6");
    }
  });

  it("3. orders NEXT commitments chronologically", () => {
    const task = makeTask({ id: "task-2", title: "Lab Prep" });
    const nextSession = makeWorkSession({
      id: "ws-2",
      taskId: "task-2",
      startsAt: "2026-08-29T14:00:00.000Z",
      endsAt: "2026-08-29T15:00:00.000Z",
    });

    const event: CalendarEvent = {
      id: "event-1",
      title: "Team Sync",
      description: null,
      start: "2026-08-29T16:00:00.000Z",
      end: "2026-08-29T16:30:00.000Z",
      allDay: false,
      eventType: "event",
      source: "life_os",
      externalId: null,
      sourceUrl: null,
      course: null,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };

    const sessionItem: CalendarItem = {
      key: "task-work-session:ws-2:2026-08-29",
      kind: "work_session",
      date: todayDate,
      task,
      workSession: nextSession,
      entry: {
        key: "task-work-session:ws-2",
        kind: "task_work_session",
        title: task.title,
        date: todayDate,
        start: nextSession.startsAt,
        end: nextSession.endsAt,
        allDay: false,
        courseKey: null,
        courseLabel: null,
        courseColor: null,
        task,
        workSession: nextSession,
        overdue: false,
        issues: [],
      },
    };

    const eventItem: CalendarItem = {
      key: "event:event-1:2026-08-29",
      kind: "event",
      date: todayDate,
      event,
      entry: {
        key: "event:event-1",
        kind: "calendar_event",
        title: event.title,
        date: todayDate,
        start: event.start,
        end: event.end,
        allDay: false,
        courseKey: null,
        courseLabel: null,
        courseColor: null,
        event,
        issues: [],
      },
    };

    const nowIso = "2026-08-29T12:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [task],
      scheduleItems: [eventItem, sessionItem], // pass in mixed order
      timeZone,
      nowIso,
      date: todayDate,
    });

    // Earliest upcoming item at 14:00 (sessionItem) should be selected as NEXT
    expect(result.next).not.toBeNull();
    expect(result.next?.kind).toBe("next_work_session");
    if (result.next?.kind === "next_work_session") {
      expect(result.next.title).toBe("Lab Prep");
      expect(result.next.minutesUntilStart).toBe(120);
    }
  });

  it("4. surfaces overdue hard deadlines calmly in TODAY without shame badges", () => {
    const overdueTask = makeTask({
      id: "task-overdue",
      title: "Submit Essay Outline",
      dueDate: "2026-08-27", // 2 days ago
      status: "todo",
      priority: "urgent",
    });

    const nowIso = "2026-08-29T10:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [overdueTask],
      scheduleItems: [],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("next_action_task");
    if (result.now.kind === "next_action_task") {
      expect(result.now.title).toBe("Submit Essay Outline");
      expect(result.now.reason).toBe("Needs attention today");
    }

    expect(result.todayItems.length).toBe(1);
    expect(result.todayItems[0].isOverdue).toBe(true);
    expect(result.todayItems[0].timing).toBe("Past deadline");
    expect(result.summary.overdueCount).toBe(1);
  });

  it("5. excludes distant backlog and someday items from active focus", () => {
    const backlogTask = makeTask({
      id: "task-someday",
      title: "Someday: Learn Rust",
      dueDate: null,
      dueAt: null,
      scheduledStart: null,
      status: "todo",
    });

    const futureTask = makeTask({
      id: "task-future",
      title: "Next Month Project",
      dueDate: "2026-09-30",
      status: "todo",
    });

    const todayTask = makeTask({
      id: "task-today",
      title: "Today Focus Item",
      dueDate: todayDate,
      status: "todo",
    });

    const nowIso = "2026-08-29T10:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [backlogTask, futureTask, todayTask],
      scheduleItems: [],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("next_action_task");
    if (result.now.kind === "next_action_task") {
      expect(result.now.title).toBe("Today Focus Item");
    }

    expect(result.todayItems.some((i) => i.id === "task-someday")).toBe(false);
    expect(result.todayItems.some((i) => i.id === "task-future")).toBe(false);
    expect(result.todayItems.some((i) => i.id === "task-today")).toBe(true);
  });

  it("6. excludes completed tasks from active action items", () => {
    const completedTask = makeTask({
      id: "task-completed",
      title: "Finished Morning Run",
      status: "completed",
      dueDate: todayDate,
      completedAt: "2026-08-29T08:00:00.000Z",
    });

    const nowIso = "2026-08-29T10:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [completedTask],
      scheduleItems: [],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("all_caught_up");
    expect(result.summary.completedTodayCount).toBe(1);
    expect(result.todayItems.length).toBe(0);
  });

  it("7. deterministically selects next action when schedule is clear", () => {
    const lowPriority = makeTask({
      id: "task-low",
      title: "Read optional article",
      priority: "low",
      dueDate: todayDate,
    });
    const highPriority = makeTask({
      id: "task-high",
      title: "Finish Math Assignment",
      priority: "urgent",
      dueDate: todayDate,
    });

    const nowIso = "2026-08-29T10:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [lowPriority, highPriority],
      scheduleItems: [],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("next_action_task");
    if (result.now.kind === "next_action_task") {
      expect(result.now.title).toBe("Finish Math Assignment");
    }

    expect(result.next?.kind).toBe("next_task");
    if (result.next?.kind === "next_task") {
      expect(result.next.title).toBe("Read optional article");
    }
  });

  it("8. handles empty-day state gracefully", () => {
    const nowIso = "2026-08-29T10:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [],
      scheduleItems: [],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("empty_day");
    expect(result.next).toBeNull();
    expect(result.todayItems.length).toBe(0);
    expect(result.summary.totalTodayTasks).toBe(0);
  });

  it("9. produces identical output for identical input (idempotence)", () => {
    const task = makeTask({ id: "task-idemp", dueDate: todayDate, priority: "medium" });
    const input = {
      tasks: [task],
      scheduleItems: [],
      timeZone,
      nowIso: "2026-08-29T10:00:00.000Z",
      date: todayDate,
    };

    const out1 = buildFocusReadModel(input);
    const out2 = buildFocusReadModel(input);

    expect(out1).toEqual(out2);
  });

  it("10. does not mutate source records", () => {
    const originalTask = Object.freeze(makeTask({
      id: "task-freeze",
      title: "Immutable Task",
      dueDate: todayDate,
    }));
    const originalTasks = Object.freeze([originalTask]);

    expect(() => {
      buildFocusReadModel({
        tasks: originalTasks,
        scheduleItems: [],
        timeZone,
        nowIso: "2026-08-29T10:00:00.000Z",
        date: todayDate,
      });
    }).not.toThrow();

    expect(originalTask.title).toBe("Immutable Task");
  });

  it("11. prioritizes imminent commitment starting in <= 15 minutes", () => {
    const externalEvent: ExternalCalendarProjection = {
      id: "ext-1",
      provider: "google",
      calendarId: "primary-cal",
      externalCalendarId: "primary",
      externalEventId: "google-event-1",
      calendarName: "Work",
      access: "read_only",
      revision: "1",
      title: "Design Review",
      startsAt: "2026-08-29T10:10:00.000Z", // 10 minutes from now
      endsAt: "2026-08-29T11:00:00.000Z",
      allDay: false,
      status: "confirmed",
    };

    const extItem: CalendarItem = {
      key: "ext:google-event-1:2026-08-29",
      kind: "external_event",
      date: todayDate,
      externalEvent,
      entry: {
        key: "ext:google-event-1",
        kind: "external_calendar_event",
        title: "Design Review",
        date: todayDate,
        start: externalEvent.startsAt,
        end: externalEvent.endsAt,
        allDay: false,
        courseKey: null,
        courseLabel: null,
        courseColor: null,
        externalEvent,
        issues: [],
      },
    };

    const task = makeTask({ dueDate: todayDate });

    const nowIso = "2026-08-29T10:00:00.000Z";
    const result = buildFocusReadModel({
      tasks: [task],
      scheduleItems: [extItem],
      timeZone,
      nowIso,
      date: todayDate,
    });

    expect(result.now.kind).toBe("imminent_commitment");
    if (result.now.kind === "imminent_commitment") {
      expect(result.now.title).toBe("Design Review");
      expect(result.now.minutesUntilStart).toBe(10);
    }
  });

  it("12. orders tasks by priority and deadline in orderTasksForFocus", () => {
    const taskLow = makeTask({ id: "t-low", title: "Low Priority", priority: "low", dueDate: todayDate });
    const taskUrgent = makeTask({ id: "t-urg", title: "Urgent Priority", priority: "urgent", dueDate: todayDate });
    const taskOverdue = makeTask({ id: "t-over", title: "Overdue Item", priority: "medium", dueDate: "2026-08-27" });

    const nowMs = Date.parse("2026-08-29T10:00:00.000Z");
    const ordered = orderTasksForFocus([taskLow, taskUrgent, taskOverdue], nowMs, timeZone);

    expect(ordered[0].id).toBe("t-over"); // overdue first
    expect(ordered[1].id).toBe("t-urg"); // urgent next
    expect(ordered[2].id).toBe("t-low"); // low last
  });
});
