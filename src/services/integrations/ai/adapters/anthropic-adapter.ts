import {
  AiAdapterError,
  AI_SYSTEM_PROMPT,
  redactAiSecrets,
} from "./adapter-base";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 20000;

export async function callAnthropicAdapter(
  prompt: string,
  model: string = "claude-3-5-sonnet-20241022",
  apiKey?: string,
): Promise<string> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key || !key.trim()) {
    throw new AiAdapterError(
      "Anthropic API key is not configured.",
      "missing_credentials",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": key.trim(),
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);

    if (response.status === 401) {
      throw new AiAdapterError("Invalid Anthropic API key.", "unauthorized", 401);
    }
    if (response.status === 429) {
      throw new AiAdapterError("Anthropic rate limit exceeded.", "rate_limited", 429);
    }
    if (!response.ok) {
      const errJson = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const rawMsg = errJson.error?.message || `Anthropic error HTTP ${response.status}`;
      throw new AiAdapterError(redactAiSecrets(rawMsg), "provider_unavailable", response.status);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const textBlock = data.content?.find((c) => c.type === "text");
    if (!textBlock || !textBlock.text) {
      throw new AiAdapterError("Anthropic returned an empty response.", "malformed_response");
    }

    return textBlock.text.trim();
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof AiAdapterError) throw err;
    if ((err as Error)?.name === "AbortError") {
      throw new AiAdapterError("Anthropic request timed out.", "timeout");
    }
    throw new AiAdapterError(
      redactAiSecrets((err as Error)?.message || "Network error connecting to Anthropic."),
      "provider_unavailable",
    );
  }
}
