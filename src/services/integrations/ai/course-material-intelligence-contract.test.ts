import { describe, expect, it } from "vitest";
import {
  parseCourseMaterialSummaryOutput,
  parseCourseMaterialStudyQuestionsOutput,
  COURSE_MATERIAL_SUMMARY_CAPABILITY,
  COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY,
} from "./course-material-intelligence-contract";
import { AiTrustError } from "./trust-contract";

describe("Course Material Intelligence Contracts", () => {
  const validHandle = "material_handle_123";

  it("parses valid material summary proposal", () => {
    const valid = JSON.stringify({
      schema_version: 1,
      type: "propose_course_material_summary",
      source_handle: validHandle,
      overview: "Introduction to relational database schemas and normal forms.",
      keyConcepts: [
        { term: "1NF", definition: "Atomic column values." },
        { term: "2NF", definition: "No partial functional dependencies." },
      ],
      practicalTakeaways: ["Decompose tables when non-key dependencies arise."],
    });

    const parsed = parseCourseMaterialSummaryOutput(valid, COURSE_MATERIAL_SUMMARY_CAPABILITY.id, validHandle);
    expect(parsed.overview).toContain("relational database schemas");
    expect(parsed.keyConcepts).toHaveLength(2);
  });

  it("parses valid study questions proposal", () => {
    const valid = JSON.stringify({
      schema_version: 1,
      type: "propose_course_material_study_questions",
      source_handle: validHandle,
      questions: [
        {
          question: "What is the primary objective of 3NF?",
          answer: "To eliminate transitive dependencies on the primary key.",
          conceptTag: "Normalization",
          difficulty: "medium",
        },
      ],
    });

    const parsed = parseCourseMaterialStudyQuestionsOutput(valid, COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id, validHandle);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].conceptTag).toBe("Normalization");
  });

  it("throws on capability mismatch", () => {
    expect(() =>
      parseCourseMaterialSummaryOutput("{}", "other.capability", validHandle),
    ).toThrow(AiTrustError);
    expect(() =>
      parseCourseMaterialStudyQuestionsOutput("{}", "other.capability", validHandle),
    ).toThrow(AiTrustError);
  });
});
