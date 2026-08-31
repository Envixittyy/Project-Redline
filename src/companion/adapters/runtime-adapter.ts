import type {
  LocalInferenceRequest,
  LocalInferenceResponse,
  LocalModelDescriptor,
  LocalProviderType,
  LocalRuntimeCapabilities,
  RuntimeHealthResult,
} from "../types";

export interface LocalRuntimeAdapter {
  readonly id: LocalProviderType;
  checkHealth(endpoint: string): Promise<RuntimeHealthResult>;
  listModels(endpoint: string): Promise<LocalModelDescriptor[]>;
  infer(
    endpoint: string,
    request: LocalInferenceRequest,
    signal?: AbortSignal,
  ): Promise<LocalInferenceResponse>;
  getCapabilities(): LocalRuntimeCapabilities;
}

export class LocalAdapterError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LocalAdapterError";
    this.code = code;
  }
}

export const MAX_RUNTIME_RESPONSE_BYTES = 1024 * 1024;
export function runtimeHttpError(status: number) {
  return new LocalAdapterError("Local runtime request failed.", status === 404 ? "model_not_found" : status >= 500 ? "provider_unavailable" : status === 429 ? "rate_limited" : "provider_rejected");
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes = MAX_RUNTIME_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    await response.body?.cancel();
    throw new LocalAdapterError(
      "Runtime response exceeded the allowed size.",
      "response_too_large",
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new LocalAdapterError(
          "Runtime response exceeded the allowed size.",
          "response_too_large",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function readBoundedJson<T>(response: Response): Promise<T> {
  const text = await readBoundedResponseText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LocalAdapterError(
      "Runtime returned malformed JSON.",
      "malformed_response",
    );
  }
}

export function normalizeLocalError(
  err: unknown,
  provider: LocalProviderType,
): LocalInferenceResponse {
  if (err instanceof LocalAdapterError) {
    return {
      ok: false,
      content: "",
      model: "",
      provider,
      error: err.code,
      failureCode: err.code === "provider_unavailable" || err.code === "model_not_found" ? "provider_unavailable" : err.code === "rate_limited" ? "rate_limited" : err.code === "provider_rejected" ? "provider_rejected" : "invalid_output",
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("Failed to fetch") ||
    message.includes("fetch failed")
  ) {
    return {
      ok: false,
      content: "",
      model: "",
      provider,
      error: `Runtime offline: Could not connect to ${provider} local server.`,
      failureCode: "provider_unavailable",
    };
  }

  if (message.includes("AbortError") || message.includes("aborted") || (err instanceof Error && ["TimeoutError", "AbortError"].includes(err.name))) {
    return {
      ok: false,
      content: "",
      model: "",
      provider,
      error: "Inference request was cancelled or timed out.",
      failureCode: "timeout",
    };
  }

  return {
    ok: false,
    content: "",
    model: "",
    provider,
    error: "The local runtime request failed.",
    failureCode: "invalid_output",
  };
}
