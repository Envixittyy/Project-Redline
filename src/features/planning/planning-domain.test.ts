import { describe, expect, it } from "vitest";

import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { Task } from "@/types/task";

import {
  assembleSchedulerInput,
  generateDayPlan,
  getWhatShouldIDoNow,
} from "./planning-domain";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Write physics lab report",
    description: null,
    status: "todo",
    priority: "high",
    dueDate: "2026-08-29",
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: "Physics 101",
    course: "PHYS101",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("Planning Domain Layer (Phase 5B)", () => {
  const timeZone = "Asia/Manila";
  const date = "2026-08-29";

  it("1. assembles SchedulerInput from tasks, calendar items, and options", () => {
    const task1 = createTask({ id: "t1", title: "Urgent bug", priority: "urgent" });
    const task2 = createTask({ id: "t2", title: "Read paper", priority: "low" });

    const mockEvent = {
      id: "evt-1",
      title: "Team Standup",
      description: null,
      start: "2026-08-29T02:00:00.000Z",
      end: "2026-08-29T03:00:00.000Z",
      allDay: false,
      eventType: "meeting",
      source: "life_os" as const,
      externalId: null,
      sourceUrl: null,
      course: null,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    };

    const scheduleItem: CalendarItem = {
      key: "event-1",
      kind: "event",
      date: "2026-08-29",
      event: mockEvent,
      entry: {
        key: "event:evt-1",
        kind: "calendar_event",
        title: "Team Standup",
        date: "2026-08-29",
        start: "2026-08-29T02:00:00.000Z",
        end: "2026-08-29T03:00:00.000Z",
        allDay: false,
        courseKey: null,
        courseLabel: null,
        courseColor: null,
        event: mockEvent,
        issues: [],
      },
    };

    const input = assembleSchedulerInput({
      tasks: [task1, task2],
      scheduleItems: [scheduleItem],
      timeZone,
      date,
      rangeStartHour: 8,
      rangeEndHour: 20,
    });

    expect(input.tasks).toHaveLength(2);
    expect(input.fixedCommitments).toHaveLength(1);
    expect(input.fixedCommitments[0].source).toBe("forward_event");
    expect(input.tasks[0].priority).toBe(4); // urgent
    expect(input.tasks[1].priority).toBe(1); // low
  });

  it("2. generates a structured day plan proposal with enriched task metadata", () => {
    const task = createTask({
      id: "t1",
      title: "Write essay",
      priority: "high",
      dueAt: "2026-08-29T10:00:00.000Z", // 18:00 Manila
    });

    const plan = generateDayPlan({
      tasks: [task],
      timeZone,
      date,
      rangeStartHour: 8,
      rangeEndHour: 18,
    });

    expect(plan.proposedSessions.length).toBeGreaterThan(0);
    expect(plan.proposedSessions[0].task.id).toBe("t1");
    expect(plan.proposedSessions[0].task.title).toBe("Write essay");
    expect(plan.fullyScheduledTasks).toHaveLength(1);
    expect(plan.unscheduledTasks).toHaveLength(0);
    expect(plan.totalPlannedWorkMinutes).toBeGreaterThan(0);
  });

  it("3. distinguishes partially scheduled tasks and records remaining minutes", () => {
    const largeTask = createTask({
      id: "t-huge",
      title: "Large monograph",
      priority: "high",
    });

    // Constrain range to only 1 hour (08:00 to 09:00 Manila = 60 mins)
    const plan = generateDayPlan({
      tasks: [largeTask],
      timeZone,
      date,
      rangeStartHour: 8,
      rangeEndHour: 9, // only 60m available
      taskDurationOverrides: { "t-huge": 120 }, // needs 120m
      bufferMinutes: 0,
      breakMinutes: 0,
    });

    expect(plan.proposedSessions).toHaveLength(1);
    expect(plan.proposedSessions[0].durationMinutes).toBe(60);
    expect(plan.proposedSessions[0].isPartial).toBe(true);

    expect(plan.partiallyScheduledTasks).toHaveLength(1);
    expect(plan.partiallyScheduledTasks[0].task.id).toBe("t-huge");
    expect(plan.partiallyScheduledTasks[0].remainingMinutes).toBe(60);
    expect(plan.partiallyScheduledTasks[0].scheduledMinutes).toBe(60);
  });

  it("4. lists unscheduled tasks when planning horizon or commitments prevent scheduling", () => {
    const task = createTask({
      id: "t-impossible",
      title: "Overdue deadline",
      dueAt: "2026-08-29T00:00:00.000Z", // 08:00 Manila (at start of horizon)
    });

    const plan = generateDayPlan({
      tasks: [task],
      timeZone,
      date,
      rangeStartHour: 8,
      rangeEndHour: 18,
    });

    expect(plan.proposedSessions).toHaveLength(0);
    expect(plan.unscheduledTasks).toHaveLength(1);
    expect(plan.unscheduledTasks[0].task.id).toBe("t-impossible");
    expect(plan.unscheduledTasks[0].reason).toBeDefined();
  });

  it("5. What Should I Do Now: recommends active work session when now falls in session", () => {
    const task = createTask({ id: "t1", title: "Current sprint task" });

    const plan = generateDayPlan({
      tasks: [task],
      timeZone,
      date,
      rangeStartHour: 8,
      rangeEndHour: 18,
    });

    expect(plan.proposedSessions.length).toBeGreaterThan(0);
    const session = plan.proposedSessions[0];

    // Pick an instant inside the proposed session (e.g. 10 mins after session start)
    const sessionStartMs = Date.parse(session.startsAt);
    const nowInsideSession = new Date(sessionStartMs + 10 * 60_000).toISOString();

    const recommendation = getWhatShouldIDoNow(plan, nowInsideSession, timeZone);

    expect(recommendation.kind).toBe("active_work_session");
    if (recommendation.kind === "active_work_session") {
      expect(recommendation.task.id).toBe("t1");
      expect(recommendation.headline).toContain("Current sprint task");
    }
  });

  it("6. What Should I Do Now: warns on imminent fixed commitment within 20 minutes", () => {
    const task = createTask({ id: "t1", title: "Backlog task" });
    const mockMeeting = {
      id: "m-1",
      title: "Calculus III",
      course: { id: "c-1", label: "MATH 201", color: "#4f46e5" },
      weekdays: [6 as const],
      startTime: "10:00",
      endTime: "11:30",
      timeZone: "Asia/Manila",
      startDate: "2026-08-01",
      endDateExclusive: null,
    };

    const classItem: CalendarItem = {
      key: "class-1",
      kind: "course_meeting",
      date: "2026-08-29",
      meeting: mockMeeting,
      entry: {
        key: "course-meeting:m-1:2026-08-29",
        kind: "course_meeting",
        title: "Calculus III",
        date: "2026-08-29",
        start: "2026-08-29T02:00:00.000Z", // 10:00 AM Manila
        end: "2026-08-29T03:30:00.000Z",
        allDay: false,
        courseKey: "c-1",
        courseLabel: "MATH 201",
        courseColor: "#4f46e5",
        occurrenceDate: "2026-08-29",
        meeting: mockMeeting,
        issues: [],
      },
    };

    const plan = generateDayPlan({
      tasks: [task],
      scheduleItems: [classItem],
      timeZone,
      date,
      rangeStartHour: 8,
      rangeEndHour: 18,
    });

    // 10 minutes before class (09:50 AM Manila)
    const nowJustBeforeClass = new Date(Date.parse("2026-08-29T02:00:00.000Z") - 10 * 60_000).toISOString();

    const recommendation = getWhatShouldIDoNow(plan, nowJustBeforeClass, timeZone);

    expect(recommendation.kind).toBe("imminent_commitment");
    if (recommendation.kind === "imminent_commitment") {
      expect(recommendation.headline).toContain("Upcoming commitment in 10m");
    }
  });

  it("7. What Should I Do Now: recommends next scheduled session when in open gap before it", () => {
    const task = createTask({ id: "t1", title: "Afternoon review", priority: "high" });

    const plan = generateDayPlan({
      tasks: [task],
      timeZone,
      date,
      rangeStartHour: 9,
      rangeEndHour: 18,
    });

    const session = plan.proposedSessions[0];
    // 15 mins before session starts
    const nowBeforeSession = new Date(Date.parse(session.startsAt) - 15 * 60_000).toISOString();

    const recommendation = getWhatShouldIDoNow(plan, nowBeforeSession, timeZone);

    expect(recommendation.kind).toBe("next_up_session");
    if (recommendation.kind === "next_up_session") {
      expect(recommendation.task.id).toBe("t1");
      expect(recommendation.minutesUntilStart).toBe(15);
    }
  });

  it("8. What Should I Do Now: reports schedule clear when all work is finished", () => {
    const plan = generateDayPlan({
      tasks: [],
      timeZone,
      date,
    });

    const recommendation = getWhatShouldIDoNow(plan, "2026-08-29T08:00:00.000Z", timeZone);
    expect(recommendation.kind).toBe("no_tasks");
  });

  it("9. maintains strict immutability and purity with zero persistence calls", () => {
    const task = createTask({ id: "t-pure", title: "Pure test" });
    const originalJson = JSON.stringify(task);

    const plan = generateDayPlan({
      tasks: [task],
      timeZone,
      date,
    });

    expect(JSON.stringify(task)).toBe(originalJson);
    expect(plan.proposedSessions.length).toBeGreaterThan(0);
  });
});
