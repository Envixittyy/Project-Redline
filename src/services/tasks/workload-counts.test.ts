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

  it("uses single database query when open tasks are within 2,000 limit", async () => {
    const mockRows = [
      { due_date: "2026-09-16", due_at: null },
      { due_date: "2026-09-15", due_at: null },
    ];

    const mockLimit = vi.fn().mockResolvedValue({
      data: mockRows,
      count: 2,
      error: null,
    });
    const mockIn = vi.fn().mockReturnValue({ limit: mockLimit });
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
    expect(mockLimit).toHaveBeenCalledWith(2000);
  });

  it("falls back to exact database head counts when open tasks exceed 2,000", async () => {
    // Simulate 2,500 total open tasks where PostgREST truncated data to 2,000 rows
    const truncatedRows = new Array(2000).fill({ due_date: null, due_at: null });

    const mockLimit = vi.fn().mockResolvedValue({
      data: truncatedRows,
      count: 2500, // Total tasks exceeds returned rows!
      error: null,
    });
    const mockInPrimary = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockEqPrimary = vi.fn().mockReturnValue({ in: mockInPrimary });
    const mockSelectPrimary = vi.fn().mockReturnValue({ eq: mockEqPrimary });

    // Fallback queries for dueToday and overdue
    const mockOrDueToday = vi.fn().mockResolvedValue({ count: 42, error: null });
    const mockOrOverdue = vi.fn().mockResolvedValue({ count: 18, error: null });

    let callCount = 0;
    mockFrom.mockImplementation((_table: string) => {
      callCount++;
      if (callCount === 1) {
        return { select: mockSelectPrimary };
      }
      // Fallback base() calls
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              or: callCount === 2 ? mockOrDueToday : mockOrOverdue,
            })),
          })),
        })),
      };
    });

    const fixedNow = new Date("2026-09-16T14:00:00.000Z");
    const result = await readTaskWorkloadCounts(fixedNow);

    // Verifies that counts are NOT truncated to 0 (which in-memory truncatedRows would have produced)
    expect(result).toEqual({
      remainingTasks: 2500,
      dueToday: 42,
      overdue: 18,
    });

    // Verifies fallback queries were executed because count (2500) > data.length (2000)
    expect(mockOrDueToday).toHaveBeenCalledTimes(1);
    expect(mockOrOverdue).toHaveBeenCalledTimes(1);
  });
});
