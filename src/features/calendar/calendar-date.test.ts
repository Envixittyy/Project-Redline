import { describe, expect, it } from "vitest";

import {
  calendarRange,
  formatCalendarHeading,
  shiftCalendarAnchor,
  weekDaysForAnchor,
} from "./calendar-date";

describe("calendar-date utilities", () => {
  it("formats month heading accurately", () => {
    expect(formatCalendarHeading("month", "2026-09-11")).toBe("September 2026");
    expect(formatCalendarHeading("month", "2027-01-01")).toBe("January 2027");
  });

  it("formats week heading within the same month without bug", () => {
    // Week for 2026-09-11 is Mon 2026-09-07 to Sun 2026-09-13
    expect(formatCalendarHeading("week", "2026-09-11")).toBe("Sep 7–13, 2026");
  });

  it("formats week heading across months within the same year", () => {
    // Week for 2026-08-31 is Mon 2026-08-31 to Sun 2026-09-06
    expect(formatCalendarHeading("week", "2026-08-31")).toBe("Aug 31 – Sep 6, 2026");
  });

  it("formats week heading across years", () => {
    // Week for 2026-12-30 is Mon 2026-12-28 to Sun 2027-01-03
    expect(formatCalendarHeading("week", "2026-12-30")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  it("formats agenda heading with anchor date", () => {
    expect(formatCalendarHeading("agenda", "2026-09-11")).toBe("Next 30 days · Sep 11");
  });

  it("generates 7 week days for an anchor date", () => {
    const days = weekDaysForAnchor("2026-09-11");
    expect(days).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("shifts calendar anchors correctly", () => {
    expect(shiftCalendarAnchor("month", "2026-09-11", -1)).toBe("2026-08-11");
    expect(shiftCalendarAnchor("month", "2026-09-11", 1)).toBe("2026-10-11");
    expect(shiftCalendarAnchor("week", "2026-09-11", -1)).toBe("2026-09-04");
    expect(shiftCalendarAnchor("week", "2026-09-11", 1)).toBe("2026-09-18");
  });

  it("calculates ranges for month, week, and agenda views", () => {
    const month = calendarRange("month", "2026-09-11");
    expect(month.fromDate).toBe("2026-08-31"); // Monday start
    expect(month.toDateExclusive).toBe("2026-10-12"); // 42 days later

    const week = calendarRange("week", "2026-09-11");
    expect(week.fromDate).toBe("2026-09-07");
    expect(week.toDateExclusive).toBe("2026-09-14");

    const agenda = calendarRange("agenda", "2026-09-11");
    expect(agenda.fromDate).toBe("2026-09-11");
    expect(agenda.toDateExclusive).toBe("2026-10-11");
  });
});
