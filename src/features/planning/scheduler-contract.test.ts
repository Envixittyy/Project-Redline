import { describe, expect, it } from "vitest";

import { orderTasksForScheduling, validateSchedulerInput, type SchedulerInput } from "./scheduler-contract";

const input: SchedulerInput = {
  range: { id: "range", startsAt: "2026-08-29T00:00:00Z", endsAt: "2026-08-30T00:00:00Z" },
  fixedCommitments: [{
    id: "class",
    startsAt: "2026-08-29T02:00:00Z",
    endsAt: "2026-08-29T03:00:00Z",
    source: "external_event",
  }],
  preferredWorkWindows: [],
  tasks: [{
    taskId: "later",
    deadline: "2026-08-29T14:00:00Z",
    durationMinutes: 60,
    priority: 2,
    earliestStart: "2026-08-29T04:00:00Z",
    splittable: false,
    minimumSessionMinutes: 60,
  }, {
    taskId: "urgent",
    deadline: "2026-08-29T16:00:00Z",
    durationMinutes: 30,
    priority: 3,
    earliestStart: "2026-08-29T04:00:00Z",
    splittable: true,
    minimumSessionMinutes: 15,
  }],
  breakMinutes: 10,
  bufferMinutes: 5,
};

describe("scheduler contract", () => {
  it("validates and orders the same input deterministically", () => {
    expect(validateSchedulerInput(input)).toEqual([]);
    expect(orderTasksForScheduling(input.tasks).map((task) => task.taskId)).toEqual(["urgent", "later"]);
    expect(input.fixedCommitments[0].source).toBe("external_event");
  });
});
