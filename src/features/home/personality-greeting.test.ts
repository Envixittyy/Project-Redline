import { describe, expect, it } from "vitest";
import {
  formatWorkloadStatus,
  getSystemLoadTelemetry,
  getTimeAwareGreeting,
} from "./personality-greeting";

describe("Home Personality Greeting (getTimeAwareGreeting)", () => {
  const timeZone = "Asia/Manila"; // UTC+8

  it("returns Adulting.exe daytime greeting in the morning", () => {
    // 08:00 Manila is 00:00 UTC
    const morning = new Date("2026-08-30T00:00:00Z");
    const res = getTimeAwareGreeting("Kyle", morning, timeZone);
    expect(res.eyebrow).toBe("SO, ANO NA?");
    expect(res.greeting).toBe("So… ano na, Kyle?");
    expect(res.subtext).toBe("Here’s what’s up.");
    expect(res.isLateNight).toBe(false);
  });

  it("returns Adulting.exe daytime greeting in the afternoon", () => {
    // 14:00 Manila is 06:00 UTC
    const afternoon = new Date("2026-08-30T06:00:00Z");
    const res = getTimeAwareGreeting("Kyle", afternoon, timeZone);
    expect(res.eyebrow).toBe("SO, ANO NA?");
    expect(res.greeting).toBe("So… ano na, Kyle?");
    expect(res.subtext).toBe("Here’s what’s up.");
    expect(res.isLateNight).toBe(false);
  });

  it("returns Adulting.exe daytime greeting in the evening", () => {
    // 20:00 Manila is 12:00 UTC
    const evening = new Date("2026-08-30T12:00:00Z");
    const res = getTimeAwareGreeting("Kyle", evening, timeZone);
    expect(res.eyebrow).toBe("SO, ANO NA?");
    expect(res.greeting).toBe("So… ano na, Kyle?");
    expect(res.subtext).toBe("Here’s what’s up.");
    expect(res.isLateNight).toBe(false);
  });

  it("returns Late Night alternate line between 00:00 and 04:59", () => {
    // 02:00 Manila is 18:00 UTC previous day
    const lateNight = new Date("2026-08-29T18:00:00Z");
    const res = getTimeAwareGreeting("Kyle", lateNight, timeZone);
    expect(res.greeting).toBe("You're still here, Kyle.");
    expect(res.subtext).toBe("Let's at least make this useful.");
    expect(res.isLateNight).toBe(true);
  });
});

describe("Deterministic Workload Assessment (getSystemLoadTelemetry & formatWorkloadStatus)", () => {
  it("formats 0 open tasks as 'Nothing urgent. Suspiciously peaceful.'", () => {
    const res = getSystemLoadTelemetry({
      openTaskCount: 0,
      dueSoonCount: 0,
      overdueCount: 0,
      todayClassCount: 0,
    });
    expect(res.telemetryText).toBe("Nothing urgent. Suspiciously peaceful.");
    expect(res.telemetryText).not.toContain("SYSTEM LOAD");
    expect(res.telemetryText).not.toContain("NOMINAL");
    expect(res.shortAssessment).not.toContain("SYSTEM LOAD");
  });

  it("formats singular open task correctly (1 thing open · pretty chill)", () => {
    const status = formatWorkloadStatus({ openTaskCount: 1 });
    expect(status).toBe("1 thing open · pretty chill");
  });

  it("formats 1–3 open tasks as pretty chill", () => {
    const status = formatWorkloadStatus({ openTaskCount: 3 });
    expect(status).toBe("3 things open · pretty chill");
  });

  it("formats 4–6 open tasks as manageable naman", () => {
    const status = formatWorkloadStatus({ openTaskCount: 5 });
    expect(status).toBe("5 things open · manageable naman");
  });

  it("formats 7–10 open tasks as medyo marami na ’to", () => {
    const status = formatWorkloadStatus({ openTaskCount: 8 });
    expect(status).toBe("8 things open · medyo marami na ’to");
  });

  it("formats 11+ open tasks as okay, shit’s piling up", () => {
    const status = formatWorkloadStatus({ openTaskCount: 12 });
    expect(status).toBe("12 things open · okay, shit’s piling up");
  });

  it("appends due soon details naturally", () => {
    const status = formatWorkloadStatus({ openTaskCount: 5, dueSoonCount: 2 });
    expect(status).toBe("5 things open · 2 due soon · manageable naman");
  });

  it("escalates tone seriously when overdue items exist", () => {
    const status = formatWorkloadStatus({
      openTaskCount: 5,
      overdueCount: 1,
      dueSoonCount: 2,
    });
    expect(status).toBe(
      "5 things open · 1 overdue · 2 due soon · handle overdue items first",
    );
    expect(status).not.toContain("chill");
  });

  it("uses urgent triage tone when 3 or more items are overdue", () => {
    const status = formatWorkloadStatus({
      openTaskCount: 10,
      overdueCount: 4,
      dueSoonCount: 3,
    });
    expect(status).toBe(
      "10 things open · 4 overdue · 3 due soon · triage immediately",
    );
  });

  it("never contains corporate or control-room phrasing", () => {
    const testCases = [
      { openTaskCount: 0, dueSoonCount: 0, overdueCount: 0, todayClassCount: 0 },
      { openTaskCount: 2, dueSoonCount: 1, overdueCount: 0, todayClassCount: 1 },
      { openTaskCount: 5, dueSoonCount: 2, overdueCount: 1, todayClassCount: 2 },
      { openTaskCount: 12, dueSoonCount: 3, overdueCount: 4, todayClassCount: 3 },
    ];

    for (const tc of testCases) {
      const res = getSystemLoadTelemetry(tc);
      expect(res.telemetryText).not.toContain("SYSTEM LOAD");
      expect(res.telemetryText).not.toContain("NOMINAL");
      expect(res.telemetryText).not.toContain("ELEVATED");
      expect(res.telemetryText).not.toContain("telemetry");
    }
  });
});
