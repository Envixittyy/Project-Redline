export type LocalProviderType = "ollama" | "llamacpp" | "openai_compatible";

export type LocalModelDescriptor = {
  id: string;
  name: string;
  provider: LocalProviderType;
  details?: Record<string, unknown>;
};

export type RuntimeHealthResult = {
  ok: boolean;
  provider: LocalProviderType;
  endpoint: string;
  models: LocalModelDescriptor[];
  error?: string;
};

export type LocalInferenceRequest = {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  formatJson?: boolean;
  /** Legacy/untrusted shape. Every adapter rejects it. */
  images?: string[];
  /** One server-authorized, normalized PNG. Paths and URLs are not representable. */
  media?: Array<{
    type: "image";
    mimeType: "image/png";
    base64: string;
    digest: string;
  }>;
};

export type LocalInferenceResponse = {
  failureCode?: "provider_unavailable" | "rate_limited" | "timeout" | "invalid_output" | "provider_rejected" | "unsupported_modality";
  ok: boolean;
  content: string;
  model: string;
  provider: LocalProviderType;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  error?: string;
};

export type CompanionPairRequest = {
  pairingSecret: string;
  clientOrigin: string;
};

export type CompanionPairResponse = {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
};

export type CompanionStatusResponse = {
  ok: boolean;
  version: string;
  paired: boolean;
  provider: LocalProviderType;
  endpoint: string;
  runtimeConnected: boolean;
  models: LocalModelDescriptor[];
  error?: string;
};

export type CompanionInferencePayload = {
  provider: LocalProviderType;
  endpoint: string;
  request: LocalInferenceRequest;
};

export type LocalRuntimeCapabilities = {
  streaming: boolean;
  jsonFormat: boolean;
  modelDiscovery: boolean;
  abortSignal: boolean;
  imageInput: boolean;
};

