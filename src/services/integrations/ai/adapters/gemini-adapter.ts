import {
  AiAdapterError,
  AI_SYSTEM_PROMPT,
  redactAiSecrets,
} from "./adapter-base";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 20000;

export async function callGeminiAdapter(
  prompt: string,
  model: string = "gemini-2.0-flash",
  apiKey?: string,
): Promise<string> {
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key || !key.trim()) {
    throw new AiAdapterError(
      "Gemini API key is not configured.",
      "missing_credentials",
    );
  }

  const cleanModel = encodeURIComponent(model);
  const endpoint = `${GEMINI_BASE}/${cleanModel}:generateContent?key=${encodeURIComponent(key.trim())}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: AI_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);

    if (response.status === 400 || response.status === 403) {
      throw new AiAdapterError("Invalid Gemini API key or request.", "unauthorized", response.status);
    }
    if (response.status === 429) {
      throw new AiAdapterError("Gemini rate limit exceeded.", "rate_limited", 429);
    }
    if (!response.ok) {
      const errJson = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      const rawMsg = errJson.error?.message || `Gemini error HTTP ${response.status}`;
      throw new AiAdapterError(redactAiSecrets(rawMsg), "provider_unavailable", response.status);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new AiAdapterError("Gemini returned an empty response.", "malformed_response");
    }

    return text.trim();
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof AiAdapterError) throw err;
    if ((err as Error)?.name === "AbortError") {
      throw new AiAdapterError("Gemini request timed out.", "timeout");
    }
    throw new AiAdapterError(
      redactAiSecrets((err as Error)?.message || "Network error connecting to Gemini."),
      "provider_unavailable",
    );
  }
}
