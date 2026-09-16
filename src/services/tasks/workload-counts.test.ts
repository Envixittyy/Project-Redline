import { describe, expect, it } from "vitest";

describe("readTaskWorkloadCounts semantics", () => {
  const today = "2026-09-16";
  const start = "2026-09-16T04:00:00.000Z";
  const end = "2026-09-17T04:00:00.000Z";
  const now = new Date("2026-09-16T14:00:00.000Z"); // 10:00 AM EDT

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const nowMs = now.getTime();

  function calculateWorkload(
    rows: Array<{ due_date: string | null; due_at: string | null }>,
    count: number,
  ) {
    let dueToday = 0;
    let overdue = 0;

    for (const row of rows) {
      const dueAtMs = row.due_at ? new Date(row.due_at).getTime() : null;
      const isDueToday =
        (dueAtMs !== null && dueAtMs >= startMs && dueAtMs < endMs) ||
        (dueAtMs === null && row.due_date === today);
      if (isDueToday) dueToday++;

      const isOverdue =
        (dueAtMs !== null && dueAtMs < nowMs) ||
        (dueAtMs === null && row.due_date !== null && row.due_date < today);
      if (isOverdue) overdue++;
    }

    return { remainingTasks: count, dueToday, overdue };
  }

  it("handles tasks without dates (someday/inbox)", () => {
    const rows = [{ due_date: null, due_at: null }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 0 });
  });

  it("handles date-only tasks due today", () => {
    const rows = [{ due_date: "2026-09-16", due_at: null }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 1, overdue: 0 });
  });

  it("handles date-only tasks overdue (due yesterday)", () => {
    const rows = [{ due_date: "2026-09-15", due_at: null }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 1 });
  });

  it("handles tasks with due_at earlier today (both dueToday and overdue)", () => {
    // 9:00 AM EDT (13:00 UTC) is before now (14:00 UTC) but within today's window
    const rows = [{ due_date: "2026-09-16", due_at: "2026-09-16T13:00:00.000Z" }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 1, overdue: 1 });
  });

  it("handles tasks with due_at later today (dueToday but not overdue)", () => {
    // 2:00 PM EDT (18:00 UTC) is after now (14:00 UTC) and within today's window
    const rows = [{ due_date: "2026-09-16", due_at: "2026-09-16T18:00:00.000Z" }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 1, overdue: 0 });
  });

  it("handles tasks with due_at yesterday (overdue but not dueToday)", () => {
    const rows = [{ due_date: "2026-09-15", due_at: "2026-09-15T20:00:00.000Z" }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 1 });
  });

  it("handles tasks with due_at tomorrow (neither dueToday nor overdue)", () => {
    const rows = [{ due_date: "2026-09-17", due_at: "2026-09-17T14:00:00.000Z" }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 0 });
  });

  it("gives precedence to due_at over due_date when due_at is non-null", () => {
    // If due_date says today but due_at is tomorrow, due_at governs
    const rows = [{ due_date: "2026-09-16", due_at: "2026-09-17T14:00:00.000Z" }];
    const res = calculateWorkload(rows, 1);
    expect(res).toEqual({ remainingTasks: 1, dueToday: 0, overdue: 0 });
  });
});
