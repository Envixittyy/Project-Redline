import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockFrom = vi.fn();

vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: vi.fn(async () => ({
    userId: "user-123",
    client: {
      from: mockFrom,
    },
  })),
}));

import {
  evaluateWorkloadFromRows,
  readTaskWorkloadCounts,
  WORKLOAD_PAGE_SIZE,
} from "./task-repository";

describe("readTaskWorkloadCounts row evaluation semantics", () => {
  const today = "2026-09-16";
  const startMs = new Date("2026-09-16T04:00:00.000Z").getTime();
  const endMs = new Date("2026-09-17T04:00:00.000Z").getTime();
  const nowMs = new Date("2026-09-16T14:00:00.000Z").getTime(); // 10:00 AM EDT

  const options = { startMs, endMs, nowMs, today };

  it("handles tasks without dates (someday/inbox)", () => {
    const rows = [{ due_date: null, due_at: null }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 0 });
  });

  it("handles date-only tasks due today", () => {
    const rows = [{ due_date: "2026-09-16", due_at: null }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 1, overdue: 0 });
  });

  it("handles date-only tasks overdue (due yesterday)", () => {
    const rows = [{ due_date: "2026-09-15", due_at: null }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 1 });
  });

  it("handles tasks with due_at earlier today (both dueToday and overdue)", () => {
    const rows = [{ due_date: "2026-09-16", due_at: "2026-09-16T13:00:00.000Z" }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 1, overdue: 1 });
  });

  it("handles tasks with due_at later today (dueToday but not overdue)", () => {
    const rows = [{ due_date: "2026-09-16", due_at: "2026-09-16T18:00:00.000Z" }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 1, overdue: 0 });
  });

  it("handles tasks with due_at yesterday (overdue but not dueToday)", () => {
    const rows = [{ due_date: "2026-09-15", due_at: "2026-09-15T20:00:00.000Z" }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 1 });
  });

  it("handles tasks with due_at tomorrow (neither dueToday nor overdue)", () => {
    const rows = [{ due_date: "2026-09-17", due_at: "2026-09-17T14:00:00.000Z" }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 0 });
  });

  it("gives precedence to due_at over due_date when due_at is non-null", () => {
    const rows = [{ due_date: "2026-09-16", due_at: "2026-09-17T14:00:00.000Z" }];
    const res = evaluateWorkloadFromRows(rows, 1, options);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 0 });
  });
});

describe("readTaskWorkloadCounts boundary & >2000-row regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses single database query when open tasks are within page size limit", async () => {
    const mockRows = [
      { due_date: "2026-09-16", due_at: null },
      { due_date: "2026-09-15", due_at: null },
    ];

    const mockRange = vi.fn().mockResolvedValue({
      data: mockRows,
      count: 2,
      error: null,
    });
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange });
    const mockIn = vi.fn().mockReturnValue({ order: mockOrder });
    const mockEq = vi.fn().mockReturnValue({ in: mockIn });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

    mockFrom.mockReturnValue({ select: mockSelect });

    const fixedNow = new Date("2026-09-16T14:00:00.000Z");
    const result = await readTaskWorkloadCounts(fixedNow);

    expect(result).toEqual({
      remainingTasks: 2,
      dueToday: 1,
      overdue: 1,
    });

    // Only 1 database query should have been executed
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockOrder).toHaveBeenCalledWith("id", { ascending: true });
    expect(mockRange).toHaveBeenCalledWith(0, WORKLOAD_PAGE_SIZE - 1);
  });

  it("paginates deterministically when open tasks exceed page size and counts across all pages", async () => {
    // Total 2,500 open tasks across 3 pages (exceeds the 2,000 ceiling):
    // Page 1: 1,000 tasks, all unscheduled (null dates), total count = 2500
    // Page 2: 1,000 tasks, including 1 task due today
    // Page 3: 500 tasks, including 1 task overdue
    const page1Rows = new Array(1000).fill(null).map(() => ({ due_date: null, due_at: null }));

    const page2Rows = new Array(1000).fill(null).map((_, i) =>
      i === 500
        ? { due_date: "2026-09-16", due_at: null } // due today on page 2
        : { due_date: null, due_at: null },
    );

    const page3Rows = new Array(500).fill(null).map((_, i) =>
      i === 250
        ? { due_date: "2026-09-15", due_at: null } // overdue on page 3
        : { due_date: null, due_at: null },
    );

    const rangeCalls: Array<[number, number]> = [];
    const mockRange = vi.fn().mockImplementation((from: number, to: number) => {
      rangeCalls.push([from, to]);
      if (from === 0) {
        return Promise.resolve({
          data: page1Rows,
          count: 2500,
          error: null,
        });
      }
      if (from === 1000) {
        return Promise.resolve({
          data: page2Rows,
          count: null,
          error: null,
        });
      }
      if (from === 2000) {
        return Promise.resolve({
          data: page3Rows,
          count: null,
          error: null,
        });
      }
      return Promise.resolve({ data: [], count: null, error: null });
    });

    const mockOrder = vi.fn().mockReturnValue({ range: mockRange });
    const mockIn = vi.fn().mockReturnValue({ order: mockOrder });
    const mockEq = vi.fn().mockReturnValue({ in: mockIn });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

    mockFrom.mockReturnValue({ select: mockSelect });

    const fixedNow = new Date("2026-09-16T14:00:00.000Z");
    const result = await readTaskWorkloadCounts(fixedNow);

    // Verifies:
    // 1. Exact remaining count
    // 2. Due-today values beyond the first page are counted (found on page 2)
    // 3. Overdue values beyond the first page are counted (found on page 3)
    expect(result).toEqual({
      remainingTasks: 2500,
      dueToday: 1,
      overdue: 1,
    });

    // Verifies exactly 3 queries were executed with sequential ranges and deterministic ordering
    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(mockOrder).toHaveBeenCalledWith("id", { ascending: true });
  });
});
