import { describe, expect, it } from "vitest";
import {
  parseScheduleOutput,
  SCHEDULE_IMAGE_CAPABILITY,
} from "./school-schedule-contract";
import { AiTrustError } from "./trust-contract";

describe("School Schedule Contract", () => {
  const validHandle = "schedule_handle_123";

  it("parses valid schedule proposal output", () => {
    const validJson = JSON.stringify({
      schema_version: 1,
      type: "import_schedule",
      source_handle: validHandle,
      courses: [
        {
          code: "CS101",
          title: "Introduction to Computer Science",
          section: "01",
          meetings: [
            {
              weekday: "monday",
              startTime: "09:00",
              endTime: "10:30",
              room: "Science 204",
            },
            {
              weekday: "wednesday",
              startTime: "09:00",
              endTime: "10:30",
              room: "Science 204",
            },
          ],
        },
      ],
    });

    const parsed = parseScheduleOutput(
      validJson,
      SCHEDULE_IMAGE_CAPABILITY.id,
      validHandle,
    );

    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0].code).toBe("CS101");
    expect(parsed.courses[0].meetings).toHaveLength(2);
    expect(parsed.courses[0].meetings[0].weekday).toBe("monday");
  });

  it("rejects capability mismatch", () => {
    expect(() =>
      parseScheduleOutput("{}", "other.capability", validHandle),
    ).toThrow(AiTrustError);
  });

  it("rejects invalid weekday or time format", () => {
    const invalidJson = JSON.stringify({
      schema_version: 1,
      type: "import_schedule",
      source_handle: validHandle,
      courses: [
        {
          code: "CS101",
          title: "Intro",
          meetings: [
            {
              weekday: "funday", // invalid
              startTime: "09:00",
              endTime: "10:30",
            },
          ],
        },
      ],
    });

    expect(() =>
      parseScheduleOutput(
        invalidJson,
        SCHEDULE_IMAGE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });

  it("rejects start time greater than or equal to end time", () => {
    const invalidTimes = JSON.stringify({
      schema_version: 1,
      type: "import_schedule",
      source_handle: validHandle,
      courses: [
        {
          code: "CS101",
          title: "Intro",
          meetings: [
            {
              weekday: "monday",
              startTime: "11:00",
              endTime: "10:00",
            },
          ],
        },
      ],
    });

    expect(() =>
      parseScheduleOutput(
        invalidTimes,
        SCHEDULE_IMAGE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });
});
