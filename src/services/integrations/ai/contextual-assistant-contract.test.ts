import { describe, expect, it } from "vitest";
import {
  parseContextualAssistantOutput,
  contextualAssistantPrompt,
  CONTEXTUAL_ASSISTANT_CAPABILITY,
} from "./contextual-assistant-contract";
import { AiTrustError } from "./trust-contract";
import { cloudAllowed, routingChain, type RoutingPreferences } from "./routing-contract";

describe("Contextual Assistant Contract & Boundaries", () => {
  const validHandle = "context_handle_123";

  const validPayload = {
    schema_version: 1,
    type: "propose_contextual_assistance",
    source_handle: validHandle,
    answer: "The assignment requires submitting a PDF report and a GitHub repository link.",
    keyCitations: ['"Submit your report as PDF and link your GitHub repo" - Syllabus Section 3'],
    suggestedFollowUps: ["What is the grading rubric?"],
  };

  describe("Output Parsing & Limits", () => {
    it("parses valid contextual assistant proposal", () => {
      const validJson = JSON.stringify(validPayload);
      const parsed = parseContextualAssistantOutput(validJson, CONTEXTUAL_ASSISTANT_CAPABILITY.id, validHandle);
      expect(parsed.answer).toContain("PDF report");
      expect(parsed.keyCitations).toHaveLength(1);
      expect(parsed.suggestedFollowUps).toHaveLength(1);
      expect(parsed.source_handle).toBe(validHandle);
    });

    it("rejects capability mismatch", () => {
      expect(() =>
        parseContextualAssistantOutput(JSON.stringify(validPayload), "other.cap", validHandle),
      ).toThrow(AiTrustError);
    });

    it("rejects handle mismatch", () => {
      expect(() =>
        parseContextualAssistantOutput(JSON.stringify(validPayload), CONTEXTUAL_ASSISTANT_CAPABILITY.id, "wrong_handle"),
      ).toThrow(AiTrustError);
    });

    it("rejects empty answer", () => {
      expect(() =>
        parseContextualAssistantOutput(
          JSON.stringify({ ...validPayload, answer: "" }),
          CONTEXTUAL_ASSISTANT_CAPABILITY.id,
          validHandle,
        ),
      ).toThrow(AiTrustError);
    });

    it("rejects excessive output without truncation", () => {
      const manyCitations = Array.from({ length: 10 }, (_, i) => `Citation ${i}`);
      const payload = JSON.stringify({ ...validPayload, keyCitations: manyCitations });
      expect(() => parseContextualAssistantOutput(payload, CONTEXTUAL_ASSISTANT_CAPABILITY.id, validHandle)).toThrow(AiTrustError);
    });

    it("rejects oversized output", () => {
      const huge = JSON.stringify({ ...validPayload, answer: "x".repeat(35000) });
      expect(() =>
        parseContextualAssistantOutput(huge, CONTEXTUAL_ASSISTANT_CAPABILITY.id, validHandle),
      ).toThrow(AiTrustError);
    });
  });

  describe("Single-Entity Context & Prompts", () => {
    it("constructs bounded prompt for single Task without relationship traversal", () => {
      const prompt = contextualAssistantPrompt(validHandle, {
        entityType: "task",
        title: "CS101 Lab 3",
        body: "Task: CS101 Lab 3, Due: 2026-09-10, Priority: high, Status: in_progress",
        userQuestion: "When is this task due?",
      });

      expect(prompt.prompt).toContain("untrusted_data");
      expect(prompt.prompt).toContain("CS101 Lab 3");
      expect(prompt.prompt).toContain("When is this task due?");
      expect(prompt.systemPrompt).toContain("propose_contextual_assistance");
    });

    it("constructs bounded prompt for Course without traversing child tasks or notes", () => {
      const prompt = contextualAssistantPrompt(validHandle, {
        entityType: "course",
        title: "MATH201 - Calculus II",
        body: "Course: MATH201 Calculus II, Instructor: Prof. Gauss, Location: Hall B",
        userQuestion: "Where does this class meet?",
      });

      expect(prompt.prompt).toContain("MATH201");
      expect(prompt.prompt).toContain("Prof. Gauss");
      expect(prompt.prompt).not.toContain("tasks");
    });

    it("constructs bounded prompt for Note", () => {
      const prompt = contextualAssistantPrompt(validHandle, {
        entityType: "note",
        title: "Study Notes on Algorithms",
        body: "Quicksort has O(n log n) expected time and O(n^2) worst case time.",
        userQuestion: "What is worst case quicksort time?",
      });

      expect(prompt.prompt).toContain("Study Notes on Algorithms");
      expect(prompt.prompt).toContain("Quicksort");
    });

    it("constructs bounded prompt for Course Material", () => {
      const prompt = contextualAssistantPrompt(validHandle, {
        entityType: "course_material",
        title: "Week 1 Slides",
        body: "Course Material (document): Week 1 Slides - Memory hierarchies and caching.",
        userQuestion: "What topic is covered?",
      });

      expect(prompt.prompt).toContain("Week 1 Slides");
      expect(prompt.prompt).toContain("caching");
    });
  });

  describe("Cloud Privacy Isolation", () => {
    const basePrefs: RoutingPreferences = {
      aiMode: "auto",
      cloudEnabled: true,
      cloudFallbackMode: "always",
      preferredCloud: "gemini",
      secondaryCloud: false,
      checklistCloud: true,
      courseImportCloud: true,
      dailyPlanCloud: true,
      courseMaterialCloud: true,
      contextualAssistantCloud: false, // Explicitly false
    };

    it("denies cloud egress when contextualAssistantCloud is false, even if all other capabilities are true", () => {
      expect(cloudAllowed(CONTEXTUAL_ASSISTANT_CAPABILITY.id, basePrefs)).toBe(false);
      expect(routingChain(basePrefs, CONTEXTUAL_ASSISTANT_CAPABILITY.id)).toEqual(["local"]);
    });

    it("allows cloud egress only when contextualAssistantCloud is true", () => {
      const prefsCtxEnabled: RoutingPreferences = {
        ...basePrefs,
        contextualAssistantCloud: true,
      };

      expect(cloudAllowed(CONTEXTUAL_ASSISTANT_CAPABILITY.id, prefsCtxEnabled)).toBe(true);
      expect(routingChain(prefsCtxEnabled, CONTEXTUAL_ASSISTANT_CAPABILITY.id)).toContain("gemini");
    });
  });
});
