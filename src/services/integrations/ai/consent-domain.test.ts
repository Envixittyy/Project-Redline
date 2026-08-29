import { describe, expect, it } from "vitest";

import { classifyPayloadData, evaluateTransferConsent } from "./consent-domain";
import type { AiContextEnvelope } from "./types";

describe("Phase 9: AI Consent and Classification Engine", () => {
  it("classifies direct prompt without app context as direct_prompt", () => {
    const envelope: AiContextEnvelope = {
      version: 1,
      purpose: "General Question",
      prompt: "What is an algorithm?",
      items: [],
      locale: "en-US",
      timeZone: "UTC",
    };

    const classes = classifyPayloadData(envelope);
    expect(classes).toEqual(["direct_prompt"]);

    const evaluation = evaluateTransferConsent(envelope, {
      cloudEnabled: true,
      cloudFallbackMode: "ask_each_time",
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.mode).toBe("direct_prompt_send");
  });

  it("requires transfer consent when private app text is included", () => {
    const envelope: AiContextEnvelope = {
      version: 1,
      purpose: "Task Breakdown",
      prompt: "Breakdown this task",
      items: [
        {
          handle: "task_1",
          entityType: "task",
          title: "Math Homework",
          description: "Chapter 4 exercises",
        },
      ],
      locale: "en-US",
      timeZone: "UTC",
    };

    const classes = classifyPayloadData(envelope);
    expect(classes).toContain("private_text");
    expect(classes).toContain("direct_prompt");

    const evaluation = evaluateTransferConsent(envelope, {
      cloudEnabled: true,
      cloudFallbackMode: "ask_each_time",
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.mode).toBe("needs_transfer_consent");
  });

  it("denies transfer when cloud AI is disabled in preferences", () => {
    const envelope: AiContextEnvelope = {
      version: 1,
      purpose: "Prompt",
      prompt: "Hello",
      items: [],
      locale: "en-US",
      timeZone: "UTC",
    };

    const evaluation = evaluateTransferConsent(envelope, {
      cloudEnabled: false,
      cloudFallbackMode: "ask_each_time",
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.mode).toBe("deny");
  });
});
