import { describe, expect, it } from "vitest";

import { redactAiSecrets } from "./adapter-base";
import { executeCloudModelCall, getModelDescriptor } from "./provider-router";

describe("Phase 9: Cloud AI Adapters & Router", () => {
  it("redacts provider API secrets in error messages", () => {
    const errorWithAnthropic = "Error from Anthropic: sk-ant-api03-abcdef123456789";
    expect(redactAiSecrets(errorWithAnthropic)).toBe("Error from Anthropic: sk-ant-***");

    const errorWithOpenAI = "Error from OpenAI: sk-proj-1234567890123456789012345";
    expect(redactAiSecrets(errorWithOpenAI)).toBe("Error from OpenAI: sk-***");

    const errorWithGemini = "Error with key AIzaSyABCDEF1234567890";
    expect(redactAiSecrets(errorWithGemini)).toBe("Error with key AIzaSy***");
  });

  it("provides descriptor with official privacy information URLs", () => {
    const anthropicDesc = getModelDescriptor("anthropic");
    expect(anthropicDesc.privacyInfoUrl).toContain("anthropic.com");

    const geminiDesc = getModelDescriptor("gemini");
    expect(geminiDesc.privacyInfoUrl).toContain("policies.google.com");

    const openaiDesc = getModelDescriptor("openai");
    expect(openaiDesc.privacyInfoUrl).toContain("openai.com");
  });

  it("fails safely with missing_credentials error when API key is not present", async () => {
    // Delete any ambient env vars in test
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      executeCloudModelCall("anthropic", "claude-3-5-sonnet-20241022", "Test prompt"),
    ).rejects.toThrow("Anthropic API key is not configured");

    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  });
});
