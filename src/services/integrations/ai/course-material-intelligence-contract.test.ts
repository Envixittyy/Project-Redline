import { describe, expect, it } from "vitest";
import {
  parseCourseMaterialSummaryOutput,
  parseCourseMaterialStudyQuestionsOutput,
  courseMaterialSummaryPrompt,
  courseMaterialStudyQuestionsPrompt,
  COURSE_MATERIAL_SUMMARY_CAPABILITY,
  COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY,
} from "./course-material-intelligence-contract";
import { AiTrustError } from "./trust-contract";
import { cloudAllowed, routingChain, type RoutingPreferences } from "./routing-contract";

describe("Course Material Intelligence Contracts & Privacy", () => {
  const validHandle = "material_handle_123";

  const validSummaryPayload = {
    schema_version: 1,
    type: "propose_course_material_summary",
    source_handle: validHandle,
    overview: "Introduction to relational database schemas and normal forms.",
    keyConcepts: [
      { term: "1NF", definition: "Atomic column values." },
      { term: "2NF", definition: "No partial functional dependencies." },
    ],
    practicalTakeaways: ["Decompose tables when non-key dependencies arise."],
  };

  const validQuestionsPayload = {
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
  };

  describe("Summary & Key Points Contract", () => {
    it("parses valid material summary proposal", () => {
      const valid = JSON.stringify(validSummaryPayload);
      const parsed = parseCourseMaterialSummaryOutput(valid, COURSE_MATERIAL_SUMMARY_CAPABILITY.id, validHandle);
      expect(parsed.overview).toContain("relational database schemas");
      expect(parsed.keyConcepts).toHaveLength(2);
      expect(parsed.keyConcepts[0].term).toBe("1NF");
      expect(parsed.practicalTakeaways).toHaveLength(1);
    });

    it("rejects capability mismatch", () => {
      expect(() =>
        parseCourseMaterialSummaryOutput(JSON.stringify(validSummaryPayload), "other.capability", validHandle),
      ).toThrow(AiTrustError);
    });

    it("rejects handle mismatch", () => {
      expect(() =>
        parseCourseMaterialSummaryOutput(JSON.stringify(validSummaryPayload), COURSE_MATERIAL_SUMMARY_CAPABILITY.id, "wrong_handle"),
      ).toThrow(AiTrustError);
    });

    it("rejects missing or empty overview", () => {
      expect(() =>
        parseCourseMaterialSummaryOutput(
          JSON.stringify({ ...validSummaryPayload, overview: "" }),
          COURSE_MATERIAL_SUMMARY_CAPABILITY.id,
          validHandle,
        ),
      ).toThrow(AiTrustError);
    });

    it("rejects excessive output without truncation", () => {
      const excessConcepts = Array.from({ length: 25 }, (_, i) => ({
        term: `Term ${i}`,
        definition: `Definition ${i}`,
      }));
      const payload = JSON.stringify({ ...validSummaryPayload, keyConcepts: excessConcepts });
      expect(() => parseCourseMaterialSummaryOutput(payload, COURSE_MATERIAL_SUMMARY_CAPABILITY.id, validHandle)).toThrow(AiTrustError);
    });

    it("rejects oversized summary output", () => {
      const huge = JSON.stringify({ ...validSummaryPayload, overview: "a".repeat(35000) });
      expect(() =>
        parseCourseMaterialSummaryOutput(huge, COURSE_MATERIAL_SUMMARY_CAPABILITY.id, validHandle),
      ).toThrow(AiTrustError);
    });
  });

  describe("Study Questions Contract", () => {
    it("parses valid study questions proposal", () => {
      const valid = JSON.stringify(validQuestionsPayload);
      const parsed = parseCourseMaterialStudyQuestionsOutput(
        valid,
        COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id,
        validHandle,
      );
      expect(parsed.questions).toHaveLength(1);
      expect(parsed.questions[0].conceptTag).toBe("Normalization");
      expect(parsed.questions[0].difficulty).toBe("medium");
    });

    it("rejects capability mismatch", () => {
      expect(() =>
        parseCourseMaterialStudyQuestionsOutput(JSON.stringify(validQuestionsPayload), "other.capability", validHandle),
      ).toThrow(AiTrustError);
    });

    it("rejects empty questions array", () => {
      expect(() =>
        parseCourseMaterialStudyQuestionsOutput(
          JSON.stringify({ ...validQuestionsPayload, questions: [] }),
          COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id,
          validHandle,
        ),
      ).toThrow(AiTrustError);
    });

    it("rejects unknown difficulty", () => {
      const withCustomDiff = JSON.stringify({
        ...validQuestionsPayload,
        questions: [{ ...validQuestionsPayload.questions[0], difficulty: "extreme" }],
      });
      expect(() => parseCourseMaterialStudyQuestionsOutput(withCustomDiff, COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id, validHandle)).toThrow(AiTrustError);
    });
  });

  describe("Prompts & Bounded Context", () => {
    const sampleMaterials = [
      { title: "Syllabus", type: "syllabus", content: "Course policy and grading structure." },
      { title: "Lecture 1", type: "lecture", content: "Introduction to computer systems." },
    ];

    it("constructs summary prompt with untrusted_data wrapper and max 3 materials", () => {
      const prompt = courseMaterialSummaryPrompt(validHandle, sampleMaterials);
      expect(prompt.prompt).toContain("untrusted_data");
      expect(prompt.prompt).toContain("Syllabus");
      expect(prompt.prompt).toContain("Lecture 1");
      expect(prompt.systemPrompt).toContain("propose_course_material_summary");
    });

    it("constructs study questions prompt with untrusted_data wrapper", () => {
      const prompt = courseMaterialStudyQuestionsPrompt(validHandle, sampleMaterials);
      expect(prompt.prompt).toContain("untrusted_data");
      expect(prompt.prompt).toContain("Syllabus");
      expect(prompt.systemPrompt).toContain("propose_course_material_study_questions");
    });
  });

  describe("Cloud Privacy Isolation", () => {
    const basePrefs: RoutingPreferences = {
      aiMode: "auto",
      cloudEnabled: true,
      cloudFallbackMode: "always",
      preferredCloud: "gemini",
      secondaryCloud: false,
      checklistCloud: false,
      courseImportCloud: false,
      dailyPlanCloud: true, // Daily plan is ON, but material must remain OFF
      courseMaterialCloud: false,
      contextualAssistantCloud: false,
    };

    it("denies cloud egress when courseMaterialCloud is false, even if dailyPlanCloud is true", () => {
      expect(cloudAllowed(COURSE_MATERIAL_SUMMARY_CAPABILITY.id, basePrefs)).toBe(false);
      expect(cloudAllowed(COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id, basePrefs)).toBe(false);
      expect(routingChain(basePrefs, COURSE_MATERIAL_SUMMARY_CAPABILITY.id)).toEqual(["local"]);
    });

    it("allows cloud egress only when courseMaterialCloud is explicitly true", () => {
      const prefsMaterialOn: RoutingPreferences = {
        ...basePrefs,
        courseMaterialCloud: true,
      };

      expect(cloudAllowed(COURSE_MATERIAL_SUMMARY_CAPABILITY.id, prefsMaterialOn)).toBe(true);
      expect(cloudAllowed(COURSE_MATERIAL_STUDY_QUESTIONS_CAPABILITY.id, prefsMaterialOn)).toBe(true);
      expect(routingChain(prefsMaterialOn, COURSE_MATERIAL_SUMMARY_CAPABILITY.id)).toContain("gemini");
    });
  });
});
