import { describe, expect, it } from "vitest";
import {
  parseBlackboardCourseOutput,
  BLACKBOARD_COURSE_IMAGE_CAPABILITY,
} from "./blackboard-screenshot-contract";
import { AiTrustError } from "./trust-contract";

describe("Blackboard Screenshot Contract", () => {
  const validHandle = "bb_handle_123";

  it("parses valid blackboard course list proposal", () => {
    const validJson = JSON.stringify({
      schema_version: 1,
      type: "import_blackboard_courses",
      source_handle: validHandle,
      courses: [
        {
          sourceLabel: "2026S-CS101-01 Intro to CS",
          code: "CS101",
          title: "Introduction to Computer Science",
          section: "01",
          term: "Spring 2026",
        },
      ],
    });

    const parsed = parseBlackboardCourseOutput(
      validJson,
      BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,
      validHandle,
    );

    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0].code).toBe("CS101");
    expect(parsed.courses[0].sourceLabel).toBe("2026S-CS101-01 Intro to CS");
  });

  it("rejects capability mismatch", () => {
    expect(() =>
      parseBlackboardCourseOutput("{}", "other.capability", validHandle),
    ).toThrow(AiTrustError);
  });

  it("rejects missing code or title", () => {
    const invalidJson = JSON.stringify({
      schema_version: 1,
      type: "import_blackboard_courses",
      source_handle: validHandle,
      courses: [
        {
          sourceLabel: "2026S-CS101-01",
          code: "",
          title: "",
        },
      ],
    });

    expect(() =>
      parseBlackboardCourseOutput(
        invalidJson,
        BLACKBOARD_COURSE_IMAGE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });
});

