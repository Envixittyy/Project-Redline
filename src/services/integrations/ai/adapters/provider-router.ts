import {
  parseAiActionProposal,
  type AiActionProposal,
} from "../action-contract";
import type { AiModelDescriptor, AiProviderId } from "../types";
import { AiAdapterError } from "./adapter-base";
import { callAnthropicAdapter } from "./anthropic-adapter";
import { callGeminiAdapter } from "./gemini-adapter";
import { callOpenAiAdapter } from "./openai-adapter";

export const MODEL_CATALOG: readonly AiModelDescriptor[] = [
  {
    providerId: "anthropic",
    modelId: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    role: "text",
    capabilities: ["text", "structured_output"],
    privacyInfoUrl: "https://www.anthropic.com/privacy",
  },
  {
    providerId: "gemini",
    modelId: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    role: "text",
    capabilities: ["text", "structured_output"],
    privacyInfoUrl: "https://policies.google.com/privacy",
  },
  {
    providerId: "openai",
    modelId: "gpt-4o-mini",
    name: "GPT-4o mini",
    role: "text",
    capabilities: ["text", "structured_output"],
    privacyInfoUrl: "https://openai.com/policies/privacy-policy",
  },
];

export function getModelDescriptor(
  providerId: AiProviderId,
  modelId?: string,
): AiModelDescriptor {
  const found = MODEL_CATALOG.find(
    (m) => m.providerId === providerId && (!modelId || m.modelId === modelId),
  );
  if (found) return found;

  const fallback = MODEL_CATALOG.find((m) => m.providerId === providerId);
  if (fallback) return fallback;

  return MODEL_CATALOG[0];
}

/**
 * Dispatches prompt to the specified cloud provider and parses the response into an AiActionProposal.
 */
export async function executeCloudModelCall(
  provider: AiProviderId,
  model: string,
  prompt: string,
  apiKey?: string,
): Promise<AiActionProposal> {
  let rawResponse: string;

  switch (provider) {
    case "anthropic":
      rawResponse = await callAnthropicAdapter(prompt, model, apiKey);
      break;
    case "gemini":
      rawResponse = await callGeminiAdapter(prompt, model, apiKey);
      break;
    case "openai":
      rawResponse = await callOpenAiAdapter(prompt, model, apiKey);
      break;
    default:
      throw new AiAdapterError(`Unsupported provider "${provider}".`, "invalid_request");
  }

  let parsedJson: unknown;
  try {
    // Clean any leading/trailing backticks if present
    const cleaned = rawResponse
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new AiAdapterError("Failed to parse provider response as JSON.", "malformed_response");
  }

  const parseResult = parseAiActionProposal(parsedJson);
  if (!parseResult.ok) {
    throw new AiAdapterError(
      `Model response violated action schema: ${parseResult.issues.join("; ")}`,
      "malformed_response",
    );
  }

  return parseResult.value;
}
