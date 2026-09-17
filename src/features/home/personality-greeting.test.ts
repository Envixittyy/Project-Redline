import { describe, expect, it } from "vitest";
import {
  getSystemLoadTelemetry,
  getTimeAwareGreeting,
} from "./personality-greeting";

describe("Home Personality Greeting (getTimeAwareGreeting)", () => {
  const timeZone = "Asia/Manila"; // UTC+8

  it("returns Morning greeting between 05:00 and 11:59", () => {
    // 08:00 Manila is 00:00 UTC
    const morning = new Date("2026-08-30T00:00:00Z");
    const res = getTimeAwareGreeting("Kyle", morning, timeZone);
    expect(res.eyebrow).toBe("SO, ANO NA?");
    expect(res.greeting).toBe("Good morning, Kyle.");
    expect(res.isLateNight).toBe(false);
  });

  it("returns Afternoon greeting between 12:00 and 16:59", () => {
    // 14:00 Manila is 06:00 UTC
    const afternoon = new Date("2026-08-30T06:00:00Z");
    const res = getTimeAwareGreeting("Kyle", afternoon, timeZone);
    expect(res.greeting).toBe("Good afternoon, Kyle.");
    expect(res.isLateNight).toBe(false);
  });

  it("returns Evening greeting between 17:00 and 23:59", () => {
    // 20:00 Manila is 12:00 UTC
    const evening = new Date("2026-08-30T12:00:00Z");
    const res = getTimeAwareGreeting("Kyle", evening, timeZone);
    expect(res.greeting).toBe("Good evening, Kyle.");
    expect(res.isLateNight).toBe(false);
  });

  it("returns Late Night rare alternate line between 00:00 and 04:59", () => {
    // 02:00 Manila is 18:00 UTC previous day
    const lateNight = new Date("2026-08-29T18:00:00Z");
    const res = getTimeAwareGreeting("Kyle", lateNight, timeZone);
    expect(res.greeting).toBe("You're still here, Kyle.");
    expect(res.subtext).toBe("Let's at least make this useful.");
    expect(res.isLateNight).toBe(true);
  });
});

describe("Deterministic System Load Telemetry (getSystemLoadTelemetry)", () => {
  it("classifies light/empty workload as nominal", () => {
    const res = getSystemLoadTelemetry({
      openTaskCount: 0,
      dueSoonCount: 0,
      overdueCount: 0,
      todayClassCount: 0,
    });
    expect(res.loadLevel).toBe("nominal");
    expect(res.telemetryText).toBe("0 OPEN · SYSTEM LOAD: NOMINAL");
    expect(res.shortAssessment).toContain("nominal");
  });

  it("classifies moderate workload cleanly", () => {
    const res = getSystemLoadTelemetry({
      openTaskCount: 2,
      dueSoonCount: 1,
      overdueCount: 0,
      todayClassCount: 1,
    });
    expect(res.loadLevel).toBe("moderate");
    expect(res.telemetryText).toBe(
      "1 CLASS · 2 OPEN · 1 DUE SOON · SYSTEM LOAD: MODERATE",
    );
    expect(res.shortAssessment).toContain("Manageable");
  });

  it("escalates workload level when overdue items exist", () => {
    const res = getSystemLoadTelemetry({
      openTaskCount: 5,
      dueSoonCount: 2,
      overdueCount: 1,
      todayClassCount: 2,
    });
    expect(res.loadLevel).toBe("heavy");
    expect(res.telemetryText).toContain("1 OVERDUE");
    expect(res.telemetryText).toContain("SYSTEM LOAD: HEAVY");
  });

  it("flags absurd workload when high volume or many overdue items exist", () => {
    const res = getSystemLoadTelemetry({
      openTaskCount: 10,
      dueSoonCount: 3,
      overdueCount: 4,
      todayClassCount: 2,
    });
    expect(res.loadLevel).toBe("absurd");
    expect(res.telemetryText).toContain("SYSTEM LOAD: ABSURD");
    expect(res.shortAssessment).toContain("Statistically concerning");
  });
});
