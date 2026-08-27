import { afterEach, describe, expect, it } from "vitest";

import {
  fromZonedInputValue,
  isIsoDate,
  isIsoInstant,
  resolveTimeZone,
  startOfDayIn,
  todayIn,
  toZonedInputValue,
} from "./day";

const originalTimeZone = process.env.APP_TIME_ZONE;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.APP_TIME_ZONE;
  else process.env.APP_TIME_ZONE = originalTimeZone;
});

describe("calendar-day validation", () => {
  it("rejects normalized but impossible dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
  });

  it("requires an explicit offset for instants", () => {
    expect(isIsoInstant("2026-08-27T16:00:00Z")).toBe(true);
    expect(isIsoInstant("2026-08-28T00:00:00+08:00")).toBe(true);
    expect(isIsoInstant("2026-08-28T00:00")).toBe(false);
  });
});

describe("workspace time zone", () => {
  it("defaults to Asia/Manila and ignores an invalid configured zone", () => {
    delete process.env.APP_TIME_ZONE;
    expect(resolveTimeZone()).toBe("Asia/Manila");
    process.env.APP_TIME_ZONE = "Not/AZone";
    expect(resolveTimeZone()).toBe("Asia/Manila");
  });

  it("converts Manila day boundaries without depending on the browser zone", () => {
    expect(startOfDayIn("2026-08-28", "Asia/Manila").toISOString()).toBe(
      "2026-08-27T16:00:00.000Z",
    );
    expect(todayIn("Asia/Manila", new Date("2026-08-27T15:59:59.999Z"))).toBe("2026-08-27");
    expect(todayIn("Asia/Manila", new Date("2026-08-27T16:00:00.000Z"))).toBe("2026-08-28");
  });

  it("round-trips a datetime-local wall clock", () => {
    const instant = fromZonedInputValue("2026-08-28T00:15", "Asia/Manila");
    expect(instant).toBe("2026-08-27T16:15:00.000Z");
    expect(toZonedInputValue(instant, "Asia/Manila")).toBe("2026-08-28T00:15");
  });

  it("rejects nonexistent DST wall clocks and chooses the earlier repeated time", () => {
    expect(() => fromZonedInputValue("2026-03-08T02:30", "America/New_York")).toThrow(
      /does not exist/,
    );
    expect(fromZonedInputValue("2026-11-01T01:30", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
});
