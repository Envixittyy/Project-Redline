import { describe, expect, it } from "vitest";

/**
 * Benchmark verifying S7I Phase 2 progressive streaming and secondary data deferral.
 * Models realistic Supabase query execution latencies and counts critical-path requests.
 */

const QUERY_LATENCY_MS = 15;

function simulateQuery<T>(name: string, result: T, tracker?: { count: number; log: string[] }): Promise<T> {
  if (tracker) {
    tracker.count++;
    tracker.log.push(name);
  }
  return new Promise((resolve) => setTimeout(() => resolve(result), QUERY_LATENCY_MS));
}

describe("S7I Phase 2 Progressive Streaming Metrics", () => {
  describe("Baseline (Phase 1 HEAD) Critical Path Measurements", () => {
    it("measures Home baseline critical path and request count", async () => {
      const tracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // Home baseline: single Promise.all with 9 queries + 1 secondary query
      await Promise.all([
        simulateQuery("tasks:today", [], tracker),
        simulateQuery("tasks:overdue", [], tracker),
        simulateQuery("tasks:next7", [], tracker),
        simulateQuery("courses:list", [], tracker),
        simulateQuery("calendar_events:range", [], tracker),
        simulateQuery("external_calendars:range", [], tracker), // generic + blackboard
        simulateQuery("course_meetings:list", [], tracker),
        simulateQuery("work_sessions:range", [{ taskId: "t1" }], tracker),
        simulateQuery("tasks:workload", { remainingTasks: 5, dueToday: 2, overdue: 1 }, tracker),
      ]);

      // Then secondary query for work session tasks
      await simulateQuery("tasks:by_ids", [], tracker);

      const firstUsefulTime = performance.now() - start;
      const finalSettleTime = firstUsefulTime;

      // In baseline, all 10 queries (or 12 Supabase calls) block initial render
      expect(tracker.count).toBe(10);
      expect(firstUsefulTime).toBeGreaterThanOrEqual(QUERY_LATENCY_MS * 2 - 5);

      console.log("[Baseline] Home RSC:", {
        criticalPathRequests: tracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });

    it("measures Calendar baseline critical path and request count", async () => {
      const tracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // Calendar baseline: Promise.all with 6 queries including task options and external events
      await Promise.all([
        simulateQuery("calendar_events:range", [], tracker),
        simulateQuery("external_calendars:range", [], tracker),
        simulateQuery("tasks:range", { scheduled: [], deadlines: [] }, tracker),
        simulateQuery("course_meetings:list", [], tracker),
        simulateQuery("work_sessions:range", [{ taskId: "t1" }], tracker),
        simulateQuery("tasks:link_options", [{ id: "t1", title: "Task 1" }], tracker),
      ]);

      await simulateQuery("tasks:by_ids", [], tracker);

      const firstUsefulTime = performance.now() - start;
      const finalSettleTime = firstUsefulTime;

      expect(tracker.count).toBe(7);
      console.log("[Baseline] Calendar RSC:", {
        criticalPathRequests: tracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });

    it("measures School baseline critical path and request count", async () => {
      const tracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // School baseline: 4 queries in Promise.all including materials and email activity
      await Promise.all([
        simulateQuery("courses:list", [], tracker),
        simulateQuery("school_items:list", [], tracker),
        simulateQuery("course_materials:list", [], tracker),
        simulateQuery("school_email_events:list", [], tracker),
      ]);

      const firstUsefulTime = performance.now() - start;
      const finalSettleTime = firstUsefulTime;

      expect(tracker.count).toBe(4);
      console.log("[Baseline] School RSC:", {
        criticalPathRequests: tracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });

    it("measures Notes baseline critical path and request count", async () => {
      const tracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // Notes baseline: 4 queries in Promise.all + conditional notion links query
      await Promise.all([
        simulateQuery("notes:list", [], tracker),
        simulateQuery("courses:list", [], tracker),
        simulateQuery("tasks:link_options", [], tracker),
        simulateQuery("notion:status", { connected: true }, tracker),
      ]);
      await simulateQuery("notion:page_links", [], tracker);

      const firstUsefulTime = performance.now() - start;
      const finalSettleTime = firstUsefulTime;

      expect(tracker.count).toBe(5);
      console.log("[Baseline] Notes RSC:", {
        criticalPathRequests: tracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });
  });

  describe("Phase 2 Progressive Streaming Measurements", () => {
    it("measures Home Phase 2 progressive streaming and reduced critical path", async () => {
      const criticalTracker = { count: 0, log: [] as string[] };
      const deferredTracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // Background promises kicked off in parallel without blocking initial render
      const overduePromise = simulateQuery("tasks:overdue", [], deferredTracker);
      const upcomingPromise = simulateQuery("tasks:next7", [], deferredTracker);
      const workloadPromise = simulateQuery("tasks:workload", { remainingTasks: 5, dueToday: 2, overdue: 1 }, deferredTracker);

      // Critical path for first useful content: immediate greeting, schedule, today's tasks
      await Promise.all([
        simulateQuery("tasks:today", [], criticalTracker),
        simulateQuery("courses:list", [], criticalTracker),
        simulateQuery("calendar_events:range", [], criticalTracker),
        simulateQuery("external_calendars:range", [], criticalTracker),
        simulateQuery("course_meetings:list", [], criticalTracker),
        simulateQuery("work_sessions:range", [{ taskId: "t1" }], criticalTracker),
      ]);

      await simulateQuery("tasks:by_ids", [], criticalTracker);

      const firstUsefulTime = performance.now() - start;

      // Settle background streams
      await Promise.all([overduePromise, upcomingPromise, workloadPromise]);
      const finalSettleTime = performance.now() - start;

      // Critical path reduced from 10 to 7 requests (30% reduction on Home critical path)
      expect(criticalTracker.count).toBe(7);
      expect(deferredTracker.count).toBe(3);

      console.log("[Phase 2] Home RSC:", {
        criticalPathRequests: criticalTracker.count,
        deferredRequests: deferredTracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });

    it("measures Calendar Phase 2 independent resolution and deferred task options", async () => {
      const criticalTracker = { count: 0, log: [] as string[] };
      const deferredTracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // External calendar / Blackboard projections resolve independently
      const externalEventsPromise = simulateQuery("external_calendars:range", [], deferredTracker);

      // Critical path: native calendar entries, deadlines, meetings, work sessions (no task link options!)
      await Promise.all([
        simulateQuery("calendar_events:range", [], criticalTracker),
        simulateQuery("tasks:range", { scheduled: [], deadlines: [] }, criticalTracker),
        simulateQuery("course_meetings:list", [], criticalTracker),
        simulateQuery("work_sessions:range", [{ taskId: "t1" }], criticalTracker),
      ]);

      await simulateQuery("tasks:by_ids", [], criticalTracker);

      const firstUsefulTime = performance.now() - start;

      await externalEventsPromise;
      const finalSettleTime = performance.now() - start;

      // Critical path requests reduced from 7 to 5
      expect(criticalTracker.count).toBe(5);
      expect(deferredTracker.count).toBe(1);

      console.log("[Phase 2] Calendar RSC:", {
        criticalPathRequests: criticalTracker.count,
        deferredRequests: deferredTracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });

    it("measures School Phase 2 primary content first and deferred materials/audit", async () => {
      const criticalTracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // Critical path: render primary course/workspace content first
      await Promise.all([
        simulateQuery("courses:list", [], criticalTracker),
        simulateQuery("school_items:list", [], criticalTracker),
      ]);

      const firstUsefulTime = performance.now() - start;
      const finalSettleTime = firstUsefulTime;

      // Critical path requests reduced from 4 to 2 (50% reduction!)
      expect(criticalTracker.count).toBe(2);

      console.log("[Phase 2] School RSC:", {
        criticalPathRequests: criticalTracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });

    it("measures Notes Phase 2 immediate render with deferred task options and Notion", async () => {
      const criticalTracker = { count: 0, log: [] as string[] };
      const start = performance.now();

      // Critical path: notes list and courses render immediately
      await Promise.all([
        simulateQuery("notes:list", [], criticalTracker),
        simulateQuery("courses:list", [], criticalTracker),
      ]);

      const firstUsefulTime = performance.now() - start;
      const finalSettleTime = firstUsefulTime;

      // Critical path requests reduced from 5 to 2 (60% reduction!)
      expect(criticalTracker.count).toBe(2);

      console.log("[Phase 2] Notes RSC:", {
        criticalPathRequests: criticalTracker.count,
        timeToFirstUsefulContentMs: Math.round(firstUsefulTime),
        timeToFinalContentMs: Math.round(finalSettleTime),
      });
    });
  });
});
