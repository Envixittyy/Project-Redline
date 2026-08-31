import "server-only";
import { LocalAdapterError, readBoundedResponseText } from "@/companion/adapters/runtime-adapter";
import type { LocalInferenceRequest } from "@/companion/types";
import { AiTrustError } from "./trust-contract";
import type { CloudProvider } from "./routing-contract";

export function cloudModel(provider: CloudProvider): string {
  const model = provider === "gemini" ? process.env.GEMINI_MODEL : process.env.OPENROUTER_MODEL;
  const pattern = provider === "gemini" ? /^gemini-[a-zA-Z0-9._-]{1,100}$/ : /^[a-zA-Z0-9-]+\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,150}$/;
  // No auto/router aliases or provider-selected model fallbacks.
  if (!model || !pattern.test(model) || model.startsWith("openrouter/") || model.endsWith(":nitro") || model.endsWith(":floor"))
    throw new AiTrustError("missing_credentials");
  return model;
}
function credential(provider: CloudProvider) {
  const key = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!key || key.length > 512 || /\s/.test(key)) throw new AiTrustError("missing_credentials");
  return key;
}
export function cloudAvailability(provider: CloudProvider) {
  try { const model = cloudModel(provider); credential(provider); return { configured: true, model, status: "not_checked" as const }; }
  catch { return { configured: false, model: null, status: "not_configured" as const }; }
}
export const CLOUD_PRIVACY_URLS = {
  gemini: "https://ai.google.dev/gemini-api/terms",
  openrouter: "https://openrouter.ai/privacy",
};

/** Fixed destinations. Caller must claim an exact persisted transfer first. */
export async function inferCloud(provider: CloudProvider, input: LocalInferenceRequest): Promise<string> {
  // No reviewed binary-transfer manifest or provider modality catalog exists yet.
  if (input.images !== undefined) throw new AiTrustError("capability_denied");
  const key = credential(provider);
  if (input.model !== cloudModel(provider)) throw new AiTrustError("provider_configuration_changed");
  if (Buffer.byteLength(input.prompt) > 32768 || Buffer.byteLength(input.systemPrompt ?? "") > 8192 ||
      !input.formatJson || (input.maxTokens ?? 2048) > 4096) throw new AiTrustError("invalid_request");
  const gemini = provider === "gemini";
  const url = gemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`
    : "https://openrouter.ai/api/v1/chat/completions";

  const body = gemini ? {
    systemInstruction: { parts: [{ text: input.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: input.maxTokens ?? 2048, candidateCount: 1 },
  } : {
    model: input.model,
    messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content: input.prompt }],
    stream: false, temperature: 0.2, max_tokens: input.maxTokens ?? 2048,
    response_format: { type: "json_object" },
    provider: { allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true },
  };
  const signal = AbortSignal.timeout(30_000);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...(gemini ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify(body), redirect: "error", cache: "no-store", signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiTrustError(response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "provider_rejected");
    }
    const data = JSON.parse(await readBoundedResponseText(response, 128 * 1024));
    let content: unknown;
    if (gemini) {
      const candidate = data.candidates?.[0];
      if (data.candidates?.length !== 1 || candidate.finishReason !== "STOP" || candidate.content?.parts?.length !== 1 ||
          candidate.content.parts[0].functionCall) throw new AiTrustError("invalid_output");
      content = candidate.content.parts[0].text;
    } else {
      const choice = data.choices?.[0];
      if (data.error || data.choices?.length !== 1 || choice.finish_reason !== "stop" || choice.message?.tool_calls || choice.message?.function_call ||
          (data.model && data.model !== input.model)) throw new AiTrustError("invalid_output");
      content = choice.message?.content;
    }
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 32768) throw new AiTrustError("invalid_output");
    return content;
  } catch (error) {
    if (error instanceof AiTrustError) throw error;
    if (signal.aborted) throw new AiTrustError("timeout");
    if (error instanceof SyntaxError || error instanceof LocalAdapterError) throw new AiTrustError("invalid_output");
    // A network error can occur after upload. No automatic cloud retry.
    throw new AiTrustError("network_unavailable");
  }
}
