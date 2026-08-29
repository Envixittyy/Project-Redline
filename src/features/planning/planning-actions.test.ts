import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateDayPlan } from "./planning-domain";
import {
  applyPlanAction,
  type ApplyPlanInput,
} from "./planning-actions";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock requireAuthenticatedSupabase
const mockUserId = "user-123";
let mockTasksData: Array<{ id: string; status: string; user_id: string }> = [];
let mockExistingWorkSessions: Array<{
  id: string;
  taskId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
}> = [];
let mockCreatedWorkSessions: Array<{
  taskId: string;
  startsAt: string;
  endsAt: string;
  source?: string;
}> = [];

vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: vi.fn(async () => {
    return {
      userId: mockUserId,
      client: {
        from: vi.fn((table: string) => {
          if (table === "tasks") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              eq: vi.fn((field: string, value: string) => {
                if (field === "user_id" && value === mockUserId) {
                  return Promise.resolve({ data: mockTasksData, error: null });
                }
                return Promise.resolve({ data: [], error: null });
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
          };
        }),
      },
    };
  }),
}));

vi.mock("@/services/work-sessions/work-session-repository", () => ({
  WorkSessionRepositoryError: class extends Error {},
  listWorkSessionsInRange: vi.fn(async () => mockExistingWorkSessions),
  createWorkSessions: vi.fn(async (drafts) => {
    mockCreatedWorkSessions.push(...drafts);
    return drafts.map((d: { taskId: string; startsAt: string; endsAt: string; source?: string }, idx: number) => ({
      id: `ws-${idx + 1}`,
      taskId: d.taskId,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      status: "planned",
      source: d.source ?? "planner",
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }),
}));

describe("Phase 5C: Planning Proposals Persistence Boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTasksData = [];
    mockExistingWorkSessions = [];
    mockCreatedWorkSessions = [];
  });

  it("1. explicit acceptance persists selected proposals into task_work_sessions with source = planner", async () => {
    mockTasksData = [
      { id: "task-1", status: "todo", user_id: mockUserId },
      { id: "task-2", status: "in_progress", user_id: mockUserId },
    ];

    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-1",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
        {
          taskId: "task-2",
          startsAt: "2026-08-29T10:30:00.000Z",
          endsAt: "2026-08-29T11:30:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);

    expect(result).toEqual({
      ok: true,
      createdCount: 2,
      alreadyAppliedCount: 0,
      totalRequested: 2,
    });
    expect(mockCreatedWorkSessions).toHaveLength(2);
    expect(mockCreatedWorkSessions[0]).toEqual({
      taskId: "task-1",
      startsAt: "2026-08-29T09:00:00.000Z",
      endsAt: "2026-08-29T10:00:00.000Z",
      source: "planner",
    });
    expect(mockCreatedWorkSessions[1]).toEqual({
      taskId: "task-2",
      startsAt: "2026-08-29T10:30:00.000Z",
      endsAt: "2026-08-29T11:30:00.000Z",
      source: "planner",
    });
  });

  it("2. unselected proposals are not persisted when user applies a subset of plan", async () => {
    mockTasksData = [
      { id: "task-1", status: "todo", user_id: mockUserId },
      { id: "task-2", status: "todo", user_id: mockUserId },
      { id: "task-3", status: "todo", user_id: mockUserId },
    ];

    // User selected only task-1 and task-3, deselected task-2
    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-1",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
        {
          taskId: "task-3",
          startsAt: "2026-08-29T13:00:00.000Z",
          endsAt: "2026-08-29T14:00:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);

    expect(result).toEqual({
      ok: true,
      createdCount: 2,
      alreadyAppliedCount: 0,
      totalRequested: 2,
    });
    expect(mockCreatedWorkSessions.map((s) => s.taskId)).toEqual(["task-1", "task-3"]);
    expect(mockCreatedWorkSessions.some((s) => s.taskId === "task-2")).toBe(false);
  });

  it("3. repeated submission (idempotency) does not produce duplicate sessions", async () => {
    mockTasksData = [{ id: "task-1", status: "todo", user_id: mockUserId }];
    mockExistingWorkSessions = [
      {
        id: "ws-existing-1",
        taskId: "task-1",
        startsAt: "2026-08-29T09:00:00.000Z",
        endsAt: "2026-08-29T10:00:00.000Z",
        status: "planned",
        source: "planner",
      },
    ];

    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-1",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);

    expect(result).toEqual({
      ok: true,
      createdCount: 0,
      alreadyAppliedCount: 1,
      totalRequested: 1,
    });
    expect(mockCreatedWorkSessions).toHaveLength(0);
  });

  it("4. deduplicates duplicate entries within the same submission batch", async () => {
    mockTasksData = [{ id: "task-1", status: "todo", user_id: mockUserId }];

    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-1",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
        {
          taskId: "task-1",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);

    expect(result).toEqual({
      ok: true,
      createdCount: 1,
      alreadyAppliedCount: 1,
      totalRequested: 2,
    });
    expect(mockCreatedWorkSessions).toHaveLength(1);
  });

  it("5. rejects invalid intervals where end time is not after start time", async () => {
    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-1",
          startsAt: "2026-08-29T10:00:00.000Z",
          endsAt: "2026-08-29T09:00:00.000Z", // end before start
        },
      ],
    };

    const result = await applyPlanAction(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("start time must be strictly before end time");
    }
  });

  it("6. rejects sessions with invalid timestamp strings", async () => {
    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-1",
          startsAt: "invalid-date",
          endsAt: "2026-08-29T09:00:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("invalid start or end timestamps");
    }
  });

  it("7. rejects missing or blank task IDs", async () => {
    const input = {
      sessions: [
        {
          taskId: "   ",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
      ],
    } as unknown as ApplyPlanInput;

    const result = await applyPlanAction(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("missing a valid task identifier");
    }
  });

  it("8. unauthorized ownership cannot be committed (tasks belonging to another user are rejected)", async () => {
    // mockTasksData is empty => task is not found for this user
    mockTasksData = [];

    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "unauthorized-or-missing-task",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("do not exist or belong to another owner");
    }
    expect(mockCreatedWorkSessions).toHaveLength(0);
  });

  it("9. stale/completed/cancelled tasks are rejected safely", async () => {
    mockTasksData = [
      { id: "task-completed", status: "completed", user_id: mockUserId },
    ];

    const input: ApplyPlanInput = {
      sessions: [
        {
          taskId: "task-completed",
          startsAt: "2026-08-29T09:00:00.000Z",
          endsAt: "2026-08-29T10:00:00.000Z",
        },
      ],
    };

    const result = await applyPlanAction(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("no longer open");
    }
    expect(mockCreatedWorkSessions).toHaveLength(0);
  });

  it("10. handles empty session submission cleanly without database calls", async () => {
    const result = await applyPlanAction({ sessions: [] });
    expect(result).toEqual({
      ok: true,
      createdCount: 0,
      alreadyAppliedCount: 0,
      totalRequested: 0,
    });
    expect(mockCreatedWorkSessions).toHaveLength(0);
  });

  it("11. Phase 5A scheduler remains pure: generating or reviewing a plan performs NO database writes", () => {
    const sampleTask = {
      id: "task-p5a",
      title: "Write essay",
      description: null,
      status: "todo" as const,
      priority: "high" as const,
      dueDate: "2026-08-29",
      dueAt: null,
      scheduledStart: null,
      scheduledEnd: null,
      area: null,
      project: null,
      course: null,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      completedAt: null,
    };

    const initialMockCount = mockCreatedWorkSessions.length;
    const plan = generateDayPlan({
      tasks: [sampleTask],
      timeZone: "Asia/Manila",
      date: "2026-08-29",
    });

    expect(plan.proposedSessions.length).toBeGreaterThan(0);
    // Zero writes occurred during plan generation / review
    expect(mockCreatedWorkSessions.length).toBe(initialMockCount);
  });

  it("12. architectural boundary: planning action mutates task_work_sessions and never calendar_events or tasks table directly", () => {
    const fileContent = readFileSync(
      resolve(process.cwd(), "src/features/planning/planning-actions.ts"),
      "utf8",
    );

    expect(fileContent).toContain("createWorkSessions");
    expect(fileContent).not.toContain('.from("calendar_events")');
    expect(fileContent).not.toContain('.from("tasks").insert');
    expect(fileContent).not.toContain('.from("tasks").update');
    expect(fileContent).not.toContain('.from("tasks").delete');
    expect(fileContent).toContain('source: "planner"');
    expect(fileContent).toContain('revalidatePath("/calendar")');
    expect(fileContent).toContain('revalidatePath("/tasks")');
    expect(fileContent).toContain('revalidatePath("/")');
  });
});
