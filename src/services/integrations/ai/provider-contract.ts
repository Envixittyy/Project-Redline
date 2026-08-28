import type { AiActionProposal } from "./action-contract";

export const aiCapabilities = ["text", "vision", "embeddings", "tools", "structured_output"] as const;
export type AiCapability = (typeof aiCapabilities)[number];

export type AiModelRole = "text" | "vision" | "embedding";
export type CloudFallbackMode = "off" | "ask_each_time" | "automatic_on_low_confidence";

export type AiModelDescriptor = {
  providerId: string;
  modelId: string;
  role: AiModelRole;
  capabilities: ReadonlySet<AiCapability>;
  execution: "local" | "cloud";
};

export type AiInterpretRequest = {
  requestId: string;
  text?: string;
  imageObjectKey?: string;
  allowedActions: readonly string[];
  locale: string;
  timeZone: string;
};

export interface AiProvider {
  readonly id: string;
  readonly execution: "local" | "cloud";
  listModels(): Promise<readonly AiModelDescriptor[]>;
  interpret(request: AiInterpretRequest, model: AiModelDescriptor): Promise<unknown>;
}

/** The only accepted model result is parsed AiActionProposal, never SQL or an SDK response. */
export type ValidatedAiResult = {
  requestId: string;
  proposal: AiActionProposal;
  providerId: string;
  modelId: string;
};

export type VisionWorkerPolicy = {
  idleTimeoutSeconds: number;
  maximumMemoryPressure: "low" | "moderate";
  unloadOnPressure: boolean;
};

export const defaultVisionWorkerPolicy: VisionWorkerPolicy = {
  idleTimeoutSeconds: 120,
  maximumMemoryPressure: "moderate",
  unloadOnPressure: true,
};

export type LocalCompanionConnection = {
  /** Browser-reachable, user-configured loopback origin; the hosted server never calls it. */
  origin: string;
  authentication: "paired_ephemeral_token";
  allowedCapabilities: readonly AiCapability[];
};

export const defaultCloudFallbackMode: CloudFallbackMode = "ask_each_time";

export type CloudTransferDecision = {
  mode: CloudFallbackMode;
  containsPrivateImage: boolean;
  userConfirmed: boolean;
};

export function maySendToCloud(decision: CloudTransferDecision): boolean {
  if (decision.mode === "off") return false;
  if (decision.containsPrivateImage) return decision.userConfirmed;
  return decision.mode === "automatic_on_low_confidence" || decision.userConfirmed;
}
