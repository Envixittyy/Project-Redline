import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/features/tasks/task-actions", () => ({
  setTaskCompletionAction: vi.fn(async () => ({ ok: true })),
}));

import { FocusView } from "./focus-view";
import type { FocusReadModel } from "./focus-domain";
import type { Task } from "@/types/task";

describe("FocusView UI", () => {
  const dummyTask: Task = {
    id: "task-hist-1",
    title: "Write Introduction for History Paper",
    description: null,
    status: "todo",
    priority: "high",
    dueDate: "2026-09-12",
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: null,
    course: "HIST 201",
    courseId: "c-1",
    parentTaskId: null,
    createdAt: "2026-09-10T12:00:00Z",
    updatedAt: "2026-09-10T12:00:00Z",
    completedAt: null,
  };

  const sampleReadModel: FocusReadModel = {
    now: {
      kind: "next_action_task",
      title: "Write Introduction for History Paper",
      reason: "Highest priority upcoming deadline",
      task: dummyTask,
      estimatedMinutes: 45,
    },
    next: {
      kind: "next_commitment",
      title: "Physics Lecture",
      startsAt: "2026-09-11T16:00:00Z",
      minutesUntilStart: 30,
      source: "course_meeting",
      meta: "PHYS 101",
    },
    todayItems: [
      {
        id: "task-hist-1",
        key: "task-hist-1",
        kind: "scheduled_task",
        title: "Write Introduction for History Paper",
        timing: "Due tomorrow",
        meta: "HIST 201",
        isOverdue: false,
        task: dummyTask,
      },
    ],
    summary: {
      totalTodayCommitments: 1,
      totalTodayTasks: 1,
      completedTodayCount: 0,
      overdueCount: 0,
    },
  };

  it("renders NOW focal task with complete button and goldfish badge", () => {
    const html = renderToStaticMarkup(
      <FocusView initialReadModel={sampleReadModel} timeZone="America/New_York" />
    );
    expect(html).toContain("Goldfish Mode");
    expect(html).toContain("Exit Focus");
    expect(html).toContain("Write Introduction for History Paper");
    expect(html).toContain("Complete task");
    expect(html).toContain("View in Tasks");
  });

  it("renders NEXT UP commitment", () => {
    const html = renderToStaticMarkup(
      <FocusView initialReadModel={sampleReadModel} timeZone="America/New_York" />
    );
    expect(html).toContain("NEXT UP");
    expect(html).toContain("Physics Lecture");
    expect(html).toContain("in 30m");
  });

  it("renders Today's Essentials list", () => {
    const html = renderToStaticMarkup(
      <FocusView initialReadModel={sampleReadModel} timeZone="America/New_York" />
    );
    expect(html).toContain("Today’s Essentials");
    expect(html).toContain("1 item");
  });
});
