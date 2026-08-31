import { describe, expect, it } from "vitest";
import {
  parseAcademicCalendarOutput,
  ACADEMIC_CALENDAR_CAPABILITY,
} from "./academic-calendar-contract";
import { AiTrustError } from "./trust-contract";

describe("Academic Calendar Contract", () => {
  const validHandle = "acad_handle_123";

  it("parses valid academic calendar proposal output", () => {
    const validJson = JSON.stringify({
      schema_version: 1,
      type: "import_academic_calendar",
      source_handle: validHandle,
      events: [
        {
          title: "Spring Term Classes Begin",
          startDate: "2026-01-12",
          allDay: true,
          eventType: "term_start",
          description: "First day of classes for Spring semester",
        },
        {
          title: "Spring Break",
          startDate: "2026-03-16",
          endDate: "2026-03-20",
          allDay: true,
          eventType: "break",
        },
      ],
    });

    const parsed = parseAcademicCalendarOutput(
      validJson,
      ACADEMIC_CALENDAR_CAPABILITY.id,
      validHandle,
    );

    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].title).toBe("Spring Term Classes Begin");
    expect(parsed.events[0].eventType).toBe("term_start");
    expect(parsed.events[1].eventType).toBe("break");
  });

  it("rejects capability mismatch", () => {
    expect(() =>
      parseAcademicCalendarOutput("{}", "other.capability", validHandle),
    ).toThrow(AiTrustError);
  });

  it("rejects invalid dates", () => {
    const invalidJson = JSON.stringify({
      schema_version: 1,
      type: "import_academic_calendar",
      source_handle: validHandle,
      events: [
        {
          title: "Spring Break",
          startDate: "not-a-date",
          allDay: true,
          eventType: "break",
        },
      ],
    });

    expect(() =>
      parseAcademicCalendarOutput(
        invalidJson,
        ACADEMIC_CALENDAR_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });
});
