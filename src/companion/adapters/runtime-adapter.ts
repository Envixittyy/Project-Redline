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
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "LocalAdapterError";
  }
}

export function normalizeLocalError(err: unknown, provider: LocalProviderType): LocalInferenceResponse {
  if (err instanceof LocalAdapterError) {
    return {
      ok: false,
      content: "",
      model: "",
      provider,
      error: `[${err.code}] ${err.message}`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("ECONNREFUSED") || message.includes("Failed to fetch") || message.includes("fetch failed")) {
    return {
      ok: false,
      content: "",
      model: "",
      provider,
      error: `Runtime offline: Could not connect to ${provider} local server.`,
    };
  }

  if (message.includes("AbortError") || message.includes("aborted")) {
    return {
      ok: false,
      content: "",
      model: "",
      provider,
      error: "Inference request was cancelled or timed out.",
    };
  }

  return {
    ok: false,
    content: "",
    model: "",
    provider,
    error: message,
  };
}
