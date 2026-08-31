import type { AiActionProposal } from "./action-contract";

export type AiProviderId = "anthropic" | "gemini" | "openai";

export type LocalProviderType = "ollama" | "llamacpp" | "openai_compatible";

export type AiCapability =
  | "text"
  | "vision"
  | "embeddings"
  | "tools"
  | "structured_output";

export type AiDataClass =
  | "direct_prompt"
  | "private_text"
  | "private_binary"
  | "forbidden";

export type AiTransferStatus =
  | "awaiting_consent"
  | "consented"
  | "dispatching"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export type CloudFallbackMode =
  | "off"
  | "ask_each_time"
  | "automatic_on_low_confidence";

export type AiPermissionMode =
  | "suggest_only"
  | "ask_before_changing"
  | "trusted_automation";

export type LocalCompanionConfig = {
  enabled: boolean;
  companionUrl: string;
  provider: LocalProviderType;
  endpoint: string;
  model: string;
  pairingToken?: string | null;
};

export type LocalCompanionStatus = {
  companionRunning: boolean;
  paired: boolean;
  runtimeConnected: boolean;
  models: Array<{ id: string; name: string; provider: LocalProviderType }>;
  error?: string;
};

export type CourseProposal = {
  code: string;
  name: string;
  section?: string | null;
  instructor?: string | null;
  location?: string | null;
  meetings?: Array<{
    weekdays: number[];
    startTime: string;
    endTime: string;
    location?: string | null;
  }>;
};

export type TaskChecklistItem = {
  title: string;
  checked: boolean;
};

export type TaskChecklist = {
  taskId: string;
  items: TaskChecklistItem[];
};

export type AiPreferences = {
  aiMode?: import("./routing-contract").AiMode;
  preferredCloud?: import("./routing-contract").CloudProvider;
  secondaryCloud?: boolean;
  checklistCloud?: boolean;
  courseImportCloud?: boolean;
  schoolScheduleCloud?: boolean;
  blackboardCourseCloud?: boolean;
  academicCalendarCloud?: boolean;
  assessmentPredictionCloud?: boolean;
  notesCloud?: boolean;
  quickCaptureCloud?: boolean;
  dailyPlanCloud?: boolean;
  courseMaterialCloud?: boolean;
  contextualAssistantCloud?: boolean;
  id: string;
  userId: string;
  cloudEnabled: boolean;
  defaultProvider: AiProviderId | null;
  textModel: string | null;
  visionModel: string | null;
  embeddingModel: string | null;
  cloudFallbackMode: CloudFallbackMode;
  permissionMode: AiPermissionMode;
  // Local Companion preferences
  localEnabled?: boolean;
  localCompanionUrl?: string;
  localProvider?: LocalProviderType;
  localEndpoint?: string;
  localModel?: string;
  localPairingToken?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiSourceReference = {
  entityType: "task" | "note" | "capture" | "event" | "schedule";
  entityId: string;
  revision: string;
  label: string;
};

export type AiContextItem = {
  handle: string; // opaque request-bound handle (e.g. "task_1", "note_1")
  entityType: "task" | "note" | "capture" | "event" | "schedule";
  title?: string;
  description?: string;
  body?: string;
  dueAt?: string | null;
  priority?: string;
  startsAt?: string;
  endsAt?: string;
};

export type AiContextEnvelope = {
  version: 1;
  purpose: string;
  prompt?: string;
  items: AiContextItem[];
  locale: string;
  timeZone: string;
};

export type AiTransferManifest = {
  transferId: string;
  provider: AiProviderId;
  model: string;
  purpose: string;
  capability: AiCapability;
  dataClasses: AiDataClass[];
  sourceCount: number;
  textByteCount: number;
  imageByteCount: number;
  allowListedFields: string[];
  sourceReferences: AiSourceReference[];
  canonicalPayloadDigest: string;
  expiresAt: string;
};

export type AiTransferRequest = {
  id: string;
  userId: string;
  provider: AiProviderId;
  model: string;
  purpose: string;
  capability: AiCapability;
  dataClasses: AiDataClass[];
  sourceCount: number;
  textByteCount: number;
  imageByteCount: number;
  allowListedFields: string[];
  sourceReferences: AiSourceReference[];
  canonicalPayloadDigest: string;
  status: AiTransferStatus;
  operationBatchId: string | null;
  errorCode: string | null;
  consentedAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  auditExpiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AiModelDescriptor = {
  providerId: AiProviderId;
  modelId: string;
  name: string;
  role: "text" | "vision" | "embedding";
  capabilities: readonly AiCapability[];
  pricingInfoUrl?: string;
  privacyInfoUrl: string;
};

export type ValidatedAiProposalResult = {
  transferId: string;
  provider: AiProviderId | LocalProviderType;
  model: string;
  proposal: AiActionProposal;
  operationBatchId: string | null;
};
