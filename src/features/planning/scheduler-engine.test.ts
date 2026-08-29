import { describe, expect, it } from "vitest";

import {
  type SchedulerInput,
  validateSchedulerInput,
} from "./scheduler-contract";
import { schedule, scheduleWork } from "./scheduler-engine";

function createBaseInput(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    range: {
      id: "day-range",
      startsAt: "2026-08-29T08:00:00.000Z",
      endsAt: "2026-08-29T18:00:00.000Z", // 10 hours = 600 mins
    },
    fixedCommitments: [],
    preferredWorkWindows: [],
    tasks: [],
    breakMinutes: 10,
    bufferMinutes: 5,
    ...overrides,
  };
}

describe("Deterministic Scheduling Engine (Phase 5A)", () => {
  // 1. No tasks
  it("1. returns empty sessions and unscheduled when there are no tasks", () => {
    const input = createBaseInput({ tasks: [] });
    const result = scheduleWork(input);

    expect(result.sessions).toEqual([]);
    expect(result.unscheduled).toEqual([]);
  });

  // 2. No fixed commitments
  it("2. schedules a task across the horizon when there are no fixed commitments", () => {
    const input = createBaseInput({
      tasks: [
        {
          taskId: "task-1",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 120,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 120,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual({
      id: "session-task-1-1",
      taskId: "task-1",
      startsAt: "2026-08-29T08:00:00.000Z",
      endsAt: "2026-08-29T10:00:00.000Z",
    });
  });

  // 3. One task fitting exactly
  it("3. schedules one task fitting exactly into an available window", () => {
    const input = createBaseInput({
      fixedCommitments: [
        {
          id: "afternoon-event",
          startsAt: "2026-08-29T10:00:00.000Z",
          endsAt: "2026-08-29T18:00:00.000Z",
          source: "forward_event",
        },
      ],
      bufferMinutes: 0,
      tasks: [
        {
          taskId: "exact-fit",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 120, // 08:00 to 10:00 = 120m
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 120,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T10:00:00.000Z");
  });

  // 4. One task larger than one available window (splittable vs unsplittable)
  it("4a. splits a splittable task across multiple available windows", () => {
    const input = createBaseInput({
      fixedCommitments: [
        {
          id: "lunch-meeting",
          startsAt: "2026-08-29T10:00:00.000Z",
          endsAt: "2026-08-29T12:00:00.000Z",
          source: "external_event",
        },
      ],
      bufferMinutes: 0,
      breakMinutes: 0,
      tasks: [
        {
          taskId: "large-splittable",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 180, // Needs 3 hours: 2 hours in slot 1 (08-10) + 1 hour in slot 2 (12-13)
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: true,
          minimumSessionMinutes: 30,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]).toEqual({
      id: "session-large-splittable-1",
      taskId: "large-splittable",
      startsAt: "2026-08-29T08:00:00.000Z",
      endsAt: "2026-08-29T10:00:00.000Z",
    });
    expect(result.sessions[1]).toEqual({
      id: "session-large-splittable-2",
      taskId: "large-splittable",
      startsAt: "2026-08-29T12:00:00.000Z",
      endsAt: "2026-08-29T13:00:00.000Z",
    });
  });

  it("4b. skips a window if an unsplittable task is larger than that window but fits a later window", () => {
    const input = createBaseInput({
      fixedCommitments: [
        {
          id: "meeting-1",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T11:00:00.000Z",
          source: "forward_event",
        },
      ],
      bufferMinutes: 0,
      breakMinutes: 0,
      // Windows: 08:00-09:00 (60m) and 11:00-18:00 (420m)
      tasks: [
        {
          taskId: "large-unsplittable",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 120, // Cannot fit in 08:00-09:00 (60m), must use 11:00-13:00
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 120,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual({
      id: "session-large-unsplittable-1",
      taskId: "large-unsplittable",
      startsAt: "2026-08-29T11:00:00.000Z",
      endsAt: "2026-08-29T13:00:00.000Z",
    });
  });

  // 5. Multiple tasks competing for time
  it("5. orders tasks by priority and packs time with break spacing", () => {
    const input = createBaseInput({
      breakMinutes: 15,
      bufferMinutes: 0,
      tasks: [
        {
          taskId: "low-priority",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
        {
          taskId: "high-priority",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 3,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(2);
    // high-priority scheduled first: 08:00 - 09:00
    expect(result.sessions[0].taskId).toBe("high-priority");
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T09:00:00.000Z");

    // low-priority scheduled after 15 min break: 09:15 - 10:15
    expect(result.sessions[1].taskId).toBe("low-priority");
    expect(result.sessions[1].startsAt).toBe("2026-08-29T09:15:00.000Z");
    expect(result.sessions[1].endsAt).toBe("2026-08-29T10:15:00.000Z");
  });

  // 6. Fixed commitment in the middle of a preferred window
  it("6. schedules around a fixed commitment that splits a preferred window", () => {
    const input = createBaseInput({
      bufferMinutes: 0,
      breakMinutes: 0,
      preferredWorkWindows: [
        {
          id: "morning-preferred",
          startsAt: "2026-08-29T08:00:00.000Z",
          endsAt: "2026-08-29T12:00:00.000Z",
          weight: 2,
        },
      ],
      fixedCommitments: [
        {
          id: "mid-morning-call",
          startsAt: "2026-08-29T09:30:00.000Z",
          endsAt: "2026-08-29T10:30:00.000Z",
          source: "forward_event",
        },
      ],
      tasks: [
        {
          taskId: "task-a",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 90, // fits in 08:00-09:30
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 90,
        },
        {
          taskId: "task-b",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60, // fits in 10:30-11:30 (still preferred window)
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].taskId).toBe("task-a");
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T09:30:00.000Z");

    expect(result.sessions[1].taskId).toBe("task-b");
    expect(result.sessions[1].startsAt).toBe("2026-08-29T10:30:00.000Z");
    expect(result.sessions[1].endsAt).toBe("2026-08-29T11:30:00.000Z");
  });

  // 7. Adjacent commitments
  it("7. merges adjacent commitments with buffer correctly", () => {
    const input = createBaseInput({
      bufferMinutes: 10,
      breakMinutes: 0,
      fixedCommitments: [
        {
          id: "event-1",
          startsAt: "2026-08-29T10:00:00.000Z",
          endsAt: "2026-08-29T11:00:00.000Z",
          source: "blackboard_event",
        },
        {
          id: "event-2",
          startsAt: "2026-08-29T11:00:00.000Z",
          endsAt: "2026-08-29T12:00:00.000Z",
          source: "blackboard_event",
        },
      ],
      tasks: [
        {
          taskId: "task-1",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T09:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    // event-1 (10:00-11:00) + event-2 (11:00-12:00) with 10m buffer -> busy from 09:50 to 12:10
    // Slot before busy is 08:00 to 09:50 (110m). Task starts at earliestStart 09:00 -> 09:00 to 10:00?
    // Wait, 09:00 + 60m = 10:00, but 09:50 is busy! So it cannot fit in 09:00-09:50 (50m).
    // Thus it must schedule after the busy period: 12:10 to 13:10!
    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T12:10:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T13:10:00.000Z");
  });

  // 8. Overlapping commitments
  it("8. merges overlapping commitments with buffer", () => {
    const input = createBaseInput({
      bufferMinutes: 15,
      breakMinutes: 0,
      fixedCommitments: [
        {
          id: "event-a",
          startsAt: "2026-08-29T10:00:00.000Z",
          endsAt: "2026-08-29T11:30:00.000Z",
          source: "external_event",
        },
        {
          id: "event-b",
          startsAt: "2026-08-29T11:00:00.000Z",
          endsAt: "2026-08-29T12:30:00.000Z",
          source: "external_event",
        },
      ],
      tasks: [
        {
          taskId: "task-overlap-test",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 30,
          priority: 1,
          earliestStart: "2026-08-29T09:40:00.000Z",
          splittable: false,
          minimumSessionMinutes: 30,
        },
      ],
    });

    const result = scheduleWork(input);

    // Overlapping events combined: 10:00 to 12:30. With 15m buffer: 09:45 to 12:45 is busy.
    // Task earliestStart is 09:40, so 09:40 to 09:45 is only 5m (< 30m).
    // Task must be scheduled after busy: 12:45 to 13:15!
    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T12:45:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T13:15:00.000Z");
  });

  // 9. Buffer handling
  it("9. enforces bufferMinutes before and after fixed commitments", () => {
    const input = createBaseInput({
      bufferMinutes: 30,
      breakMinutes: 0,
      fixedCommitments: [
        {
          id: "class",
          startsAt: "2026-08-29T12:00:00.000Z",
          endsAt: "2026-08-29T13:00:00.000Z",
          source: "blackboard_event",
        },
      ],
      tasks: [
        {
          taskId: "task-before",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T10:45:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    // 12:00 - 13:00 with 30m buffer makes 11:30 - 13:30 busy.
    // 10:45 to 11:30 is 45m (< 60m), so task-before cannot fit before 11:30.
    // It must start at 13:30!
    expect(result.unscheduled).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T13:30:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T14:30:00.000Z");
  });

  // 10. Break handling
  it("10. enforces breakMinutes between consecutive work sessions", () => {
    const input = createBaseInput({
      bufferMinutes: 0,
      breakMinutes: 20,
      tasks: [
        {
          taskId: "task-1",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
        {
          taskId: "task-2",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T09:00:00.000Z");

    // 20 min break after task-1 -> task-2 starts at 09:20
    expect(result.sessions[1].startsAt).toBe("2026-08-29T09:20:00.000Z");
    expect(result.sessions[1].endsAt).toBe("2026-08-29T10:20:00.000Z");
  });

  // 11. Task deadline ordering
  it("11. schedules earlier deadline task first when priorities are equal", () => {
    const input = createBaseInput({
      breakMinutes: 0,
      bufferMinutes: 0,
      tasks: [
        {
          taskId: "later-deadline",
          deadline: "2026-08-29T16:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
        {
          taskId: "earlier-deadline",
          deadline: "2026-08-29T12:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].taskId).toBe("earlier-deadline");
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[1].taskId).toBe("later-deadline");
    expect(result.sessions[1].startsAt).toBe("2026-08-29T09:00:00.000Z");
  });

  // 12. Priority ordering taking precedence over deadlines
  it("12. schedules higher priority task first even if its deadline is later", () => {
    const input = createBaseInput({
      breakMinutes: 0,
      bufferMinutes: 0,
      tasks: [
        {
          taskId: "urgent-priority",
          deadline: "2026-08-29T17:00:00.000Z",
          durationMinutes: 60,
          priority: 4,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
        {
          taskId: "low-priority-earlier-deadline",
          deadline: "2026-08-29T11:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].taskId).toBe("urgent-priority");
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[1].taskId).toBe("low-priority-earlier-deadline");
    expect(result.sessions[1].startsAt).toBe("2026-08-29T09:00:00.000Z");
  });

  // 13. Partially schedulable task
  it("13. partially schedules a task and reports unscheduled remainder when available time is insufficient", () => {
    const input = createBaseInput({
      range: {
        id: "short-day",
        startsAt: "2026-08-29T08:00:00.000Z",
        endsAt: "2026-08-29T10:00:00.000Z", // 120 mins available
      },
      bufferMinutes: 0,
      breakMinutes: 0,
      tasks: [
        {
          taskId: "huge-task",
          deadline: "2026-08-29T10:00:00.000Z",
          durationMinutes: 180, // Needs 180 mins, but only 120 mins available
          priority: 3,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: true,
          minimumSessionMinutes: 30,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].taskId).toBe("huge-task");
    expect(result.sessions[0].startsAt).toBe("2026-08-29T08:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T10:00:00.000Z");

    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0].taskId).toBe("huge-task");
    expect(result.unscheduled[0].reason).toContain("Partially scheduled: 120 of 180 minutes placed");
  });

  // 14. Completely unschedulable task
  it("14. reports completely unschedulable tasks with clear reasons", () => {
    const input = createBaseInput({
      fixedCommitments: [
        {
          id: "all-day-block",
          startsAt: "2026-08-29T08:00:00.000Z",
          endsAt: "2026-08-29T18:00:00.000Z",
          source: "protected_time",
        },
      ],
      bufferMinutes: 0,
      tasks: [
        {
          taskId: "cannot-fit",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toEqual([]);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0].taskId).toBe("cannot-fit");
    expect(result.unscheduled[0].reason).toContain("No available time window");
  });

  // 15. Deterministic repeat execution
  it("15. produces identical output over multiple repeated runs", () => {
    const input = createBaseInput({
      fixedCommitments: [
        {
          id: "c1",
          startsAt: "2026-08-29T11:00:00.000Z",
          endsAt: "2026-08-29T13:00:00.000Z",
          source: "forward_event",
        },
      ],
      preferredWorkWindows: [
        {
          id: "w1",
          startsAt: "2026-08-29T08:00:00.000Z",
          endsAt: "2026-08-29T11:00:00.000Z",
          weight: 2,
        },
        {
          id: "w2",
          startsAt: "2026-08-29T14:00:00.000Z",
          endsAt: "2026-08-29T17:00:00.000Z",
          weight: 1,
        },
      ],
      tasks: [
        {
          taskId: "t1",
          deadline: "2026-08-29T17:00:00.000Z",
          durationMinutes: 90,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: true,
          minimumSessionMinutes: 30,
        },
        {
          taskId: "t2",
          deadline: "2026-08-29T16:00:00.000Z",
          durationMinutes: 60,
          priority: 3,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const run1 = scheduleWork(input);
    const run2 = scheduleWork(input);
    const run3 = scheduleWork(input);

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  // 16. Input is not mutated
  it("16. never mutates the input objects or arrays", () => {
    const input: SchedulerInput = Object.freeze({
      range: Object.freeze({
        id: "day-range",
        startsAt: "2026-08-29T08:00:00.000Z",
        endsAt: "2026-08-29T18:00:00.000Z",
      }),
      fixedCommitments: Object.freeze([
        Object.freeze({
          id: "meeting",
          startsAt: "2026-08-29T10:00:00.000Z",
          endsAt: "2026-08-29T11:00:00.000Z",
          source: "external_event" as const,
        }),
      ]),
      preferredWorkWindows: Object.freeze([
        Object.freeze({
          id: "pref-1",
          startsAt: "2026-08-29T08:00:00.000Z",
          endsAt: "2026-08-29T12:00:00.000Z",
          weight: 2,
        }),
      ]),
      tasks: Object.freeze([
        Object.freeze({
          taskId: "task-frozen",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        }),
      ]),
      breakMinutes: 10,
      bufferMinutes: 5,
    });

    expect(() => scheduleWork(input)).not.toThrow();
    const result = scheduleWork(input);
    expect(result.sessions).toHaveLength(1);
  });

  // 17. Zero/invalid intervals rejected by validation
  it("17. rejects invalid input via validation and reports unscheduled reasons without throwing", () => {
    const invalidInput: SchedulerInput = {
      range: {
        id: "invalid-range",
        startsAt: "2026-08-29T18:00:00.000Z",
        endsAt: "2026-08-29T08:00:00.000Z", // inverted!
      },
      fixedCommitments: [
        {
          id: "bad-commitment",
          startsAt: "not-a-date",
          endsAt: "2026-08-29T10:00:00.000Z",
          source: "forward_event",
        },
      ],
      preferredWorkWindows: [],
      tasks: [
        {
          taskId: "bad-task",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: -30,
          priority: 1,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
      breakMinutes: -5,
      bufferMinutes: 5,
    };

    const validation = validateSchedulerInput(invalidInput);
    expect(validation.length).toBeGreaterThan(0);

    const result = scheduleWork(invalidInput);
    expect(result.sessions).toEqual([]);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0].reason).toContain("Input validation failed");
  });

  // 18. Scheduling horizon boundary
  it("18. respects scheduling horizon boundaries strictly", () => {
    const input = createBaseInput({
      range: {
        id: "exact-range",
        startsAt: "2026-08-29T09:00:00.000Z",
        endsAt: "2026-08-29T17:00:00.000Z",
      },
      bufferMinutes: 15,
      breakMinutes: 0,
      fixedCommitments: [
        {
          id: "early-external",
          startsAt: "2026-08-29T08:00:00.000Z",
          endsAt: "2026-08-29T09:15:00.000Z", // ends 15m after horizon start
          source: "external_event",
        },
      ],
      tasks: [
        {
          taskId: "task-horizon",
          deadline: "2026-08-29T20:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T07:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    // early-external ends at 09:15 + 15m buffer = 09:30.
    // Task cannot start before 09:30 or before horizon 09:00.
    // Earliest start for task is 09:30.
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T09:30:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T10:30:00.000Z");
  });

  // Additional invariant: Earliest start enforcement
  it("19. does not schedule tasks before their earliestStart instant", () => {
    const input = createBaseInput({
      bufferMinutes: 0,
      breakMinutes: 0,
      tasks: [
        {
          taskId: "afternoon-task",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 1,
          earliestStart: "2026-08-29T14:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].startsAt).toBe("2026-08-29T14:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T15:00:00.000Z");
  });

  // Additional invariant: Preferred work windows prioritize higher weighted windows
  it("20. places tasks into higher weighted preferred windows before lower weighted or non-preferred windows", () => {
    const input = createBaseInput({
      bufferMinutes: 0,
      breakMinutes: 0,
      preferredWorkWindows: [
        {
          id: "low-weight-morning",
          startsAt: "2026-08-29T08:00:00.000Z",
          endsAt: "2026-08-29T11:00:00.000Z",
          weight: 1,
        },
        {
          id: "high-weight-afternoon",
          startsAt: "2026-08-29T13:00:00.000Z",
          endsAt: "2026-08-29T16:00:00.000Z",
          weight: 3,
        },
      ],
      tasks: [
        {
          taskId: "task-weighted",
          deadline: "2026-08-29T18:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T08:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toHaveLength(1);
    // Weight 3 (13:00-16:00) is preferred over Weight 1 (08:00-11:00)
    expect(result.sessions[0].startsAt).toBe("2026-08-29T13:00:00.000Z");
    expect(result.sessions[0].endsAt).toBe("2026-08-29T14:00:00.000Z");
  });

  // Additional invariant: Earliest start at or after deadline
  it("21. reports unscheduled when task earliestStart is at or after deadline", () => {
    const input = createBaseInput({
      tasks: [
        {
          taskId: "impossible-deadline",
          deadline: "2026-08-29T10:00:00.000Z",
          durationMinutes: 60,
          priority: 2,
          earliestStart: "2026-08-29T11:00:00.000Z",
          splittable: false,
          minimumSessionMinutes: 60,
        },
      ],
    });

    const result = scheduleWork(input);

    expect(result.sessions).toEqual([]);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0].taskId).toBe("impossible-deadline");
    expect(result.unscheduled[0].reason).toContain("Earliest start");
  });

  it("22. exposes schedule alias identical to scheduleWork", () => {
    expect(schedule).toBe(scheduleWork);
  });
});
