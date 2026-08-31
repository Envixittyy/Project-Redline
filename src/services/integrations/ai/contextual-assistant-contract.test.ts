import { describe, expect, it } from "vitest";
import {
  parseContextualAssistantOutput,
  CONTEXTUAL_ASSISTANT_CAPABILITY,
} from "./contextual-assistant-contract";
import { AiTrustError } from "./trust-contract";

describe("Contextual Assistant Contract", () => {
  const validHandle = "context_handle_123";

  it("parses valid contextual assistant proposal", () => {
    const valid = JSON.stringify({
      schema_version: 1,
      type: "propose_contextual_assistance",
      source_handle: validHandle,
      answer: "The assignment requires submitting a PDF report and a GitHub repository link.",
      keyCitations: ['"Submit your report as PDF and link your GitHub repo" - Syllabus Section 3'],
      suggestedFollowUps: ["What is the grading rubric?"],
    });

    const parsed = parseContextualAssistantOutput(valid, CONTEXTUAL_ASSISTANT_CAPABILITY.id, validHandle);
    expect(parsed.answer).toContain("PDF report");
    expect(parsed.keyCitations).toHaveLength(1);
    expect(parsed.suggestedFollowUps).toHaveLength(1);
  });

  it("rejects capability mismatch", () => {
    expect(() => parseContextualAssistantOutput("{}", "other.cap", validHandle)).toThrow(AiTrustError);
  });
});

