import {
  AiAdapterError,
  AI_SYSTEM_PROMPT,
  redactAiSecrets,
} from "./adapter-base";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 20000;

export async function callOpenAiAdapter(
  prompt: string,
  model: string = "gpt-4o-mini",
  apiKey?: string,
): Promise<string> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key || !key.trim()) {
    throw new AiAdapterError(
      "OpenAI API key is not configured.",
      "missing_credentials",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);

    if (response.status === 401) {
      throw new AiAdapterError("Invalid OpenAI API key.", "unauthorized", 401);
    }
    if (response.status === 429) {
      throw new AiAdapterError("OpenAI rate limit exceeded.", "rate_limited", 429);
    }
    if (!response.ok) {
      const errJson = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const rawMsg = errJson.error?.message || `OpenAI error HTTP ${response.status}`;
      throw new AiAdapterError(redactAiSecrets(rawMsg), "provider_unavailable", response.status);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new AiAdapterError("OpenAI returned an empty response.", "malformed_response");
    }

    return text.trim();
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof AiAdapterError) throw err;
    if ((err as Error)?.name === "AbortError") {
      throw new AiAdapterError("OpenAI request timed out.", "timeout");
    }
    throw new AiAdapterError(
      redactAiSecrets((err as Error)?.message || "Network error connecting to OpenAI."),
      "provider_unavailable",
    );
  }
}
