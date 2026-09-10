import { describe, expect, it } from "vitest";
import { getTimeOfDay } from "./time-of-day";

describe("getTimeOfDay", () => {
  it("classifies morning between 05:00 and 11:59", () => {
    const morningStart = new Date("2026-09-10T05:00:00");
    const morningMid = new Date("2026-09-10T09:30:00");
    const morningEnd = new Date("2026-09-10T11:59:59");

    expect(getTimeOfDay(morningStart)).toBe("morning");
    expect(getTimeOfDay(morningMid)).toBe("morning");
    expect(getTimeOfDay(morningEnd)).toBe("morning");
  });

  it("classifies afternoon between 12:00 and 17:59", () => {
    const afternoonStart = new Date("2026-09-10T12:00:00");
    const afternoonMid = new Date("2026-09-10T15:00:00");
    const afternoonEnd = new Date("2026-09-10T17:59:59");

    expect(getTimeOfDay(afternoonStart)).toBe("afternoon");
    expect(getTimeOfDay(afternoonMid)).toBe("afternoon");
    expect(getTimeOfDay(afternoonEnd)).toBe("afternoon");
  });

  it("classifies evening between 18:00 and 21:59", () => {
    const eveningStart = new Date("2026-09-10T18:00:00");
    const eveningMid = new Date("2026-09-10T20:15:00");
    const eveningEnd = new Date("2026-09-10T21:59:59");

    expect(getTimeOfDay(eveningStart)).toBe("evening");
    expect(getTimeOfDay(eveningMid)).toBe("evening");
    expect(getTimeOfDay(eveningEnd)).toBe("evening");
  });

  it("classifies late-night between 22:00 and 04:59", () => {
    const nightStart = new Date("2026-09-10T22:00:00");
    const midnight = new Date("2026-09-10T00:00:00");
    const dawn = new Date("2026-09-10T04:59:59");

    expect(getTimeOfDay(nightStart)).toBe("late-night");
    expect(getTimeOfDay(midnight)).toBe("late-night");
    expect(getTimeOfDay(dawn)).toBe("late-night");
  });
});
