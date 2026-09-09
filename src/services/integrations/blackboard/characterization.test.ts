import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { characterizeBlackboardCalendar } from "./characterization";

describe("Blackboard calendar characterization", () => {
  it("reports structure without emitting bearer URLs or private field values", async () => {
    const source = await readFile(
      new URL("./fixtures/calendar-synthetic.ics", import.meta.url),
      "utf8",
    );
    const report = await characterizeBlackboardCalendar(source);
    const serialized = JSON.stringify(report);

    expect(report.calendar.eventCount).toBe(3);
    expect(report.events[0]).toMatchObject({
      uid: { present: true, pattern: "local-part@host" },
      dtstart: { present: true, kind: "date-time", timeZone: "Asia/Manila" },
      url: {
        present: true,
        host: "learn.example.edu",
        queryKeys: ["content_id", "course_id"],
      },
      sequence: { present: true, kind: "number" },
    });
    expect(report.events[1].dtstart.kind).toBe("date");
    expect(report.events[2].recurrenceRule.present).toBe(true);
    expect(serialized).not.toContain("synthetic-assignment-1001");
    expect(serialized).not.toContain("Assignment 1");
    expect(serialized).not.toContain("_201_1");
    expect(serialized).not.toContain("uploadAssignment?");
  });
});
