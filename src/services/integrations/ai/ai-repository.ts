import "server-only";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";

import { isMutatingAiAction, type AiActionProposal, type ProposedAiAction } from "./action-contract";
import { executeCloudModelCall, getModelDescriptor } from "./adapters/provider-router";
import { evaluateTransferConsent } from "./consent-domain";
import {
  minimizeContext,
  type ContextMinimizationResult,
  type RawContextInput,
} from "./context-minimizer";
import {
  buildPromptWithContext,
  resolveActionHandles,
  type EntityHandleMap,
} from "./entity-handles";
import { computePayloadDigest } from "./payload-digest";
import type {
  AiContextEnvelope,
  AiPreferences,
  AiProviderId,
  AiTransferManifest,
  ValidatedAiProposalResult,
} from "./types";

export class AiRepositoryError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "AiRepositoryError";
  }
}

type PreferencesRow = {
  id: string;
  user_id: string;
  cloud_enabled: boolean;
  default_provider: AiProviderId | null;
  text_model: string | null;
  vision_model: string | null;
  embedding_model: string | null;
  cloud_fallback_mode: "off" | "ask_each_time" | "automatic_on_low_confidence";
  permission_mode: "suggest_only" | "ask_before_changing" | "trusted_automation";
  created_at: string;
  updated_at: string;
};

function toAiPreferences(row: PreferencesRow): AiPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    cloudEnabled: row.cloud_enabled,
    defaultProvider: row.default_provider,
    textModel: row.text_model,
    visionModel: row.vision_model,
    embeddingModel: row.embedding_model,
    cloudFallbackMode: row.cloud_fallback_mode,
    permissionMode: row.permission_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Retrieves or initializes the user's AI preferences. */
export async function getAiPreferences(): Promise<AiPreferences> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client
    .from("ai_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[ai] fetch preferences error:", formatPostgrestErrorDiagnostic(error));
    throw new AiRepositoryError("Could not retrieve AI preferences.");
  }

  if (data) {
    return toAiPreferences(data as PreferencesRow);
  }

  // Create default preferences
  const { data: created, error: insertError } = await client
    .from("ai_preferences")
    .insert({
      user_id: userId,
      cloud_enabled: false,
      default_provider: "anthropic",
      cloud_fallback_mode: "ask_each_time",
      permission_mode: "ask_before_changing",
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[ai] insert preferences error:", formatPostgrestErrorDiagnostic(insertError));
    throw new AiRepositoryError("Could not initialize AI preferences.");
  }

  return toAiPreferences(created as PreferencesRow);
}

/** Updates user AI preferences. */
export async function updateAiPreferences(
  patch: Partial<Pick<AiPreferences, "cloudEnabled" | "defaultProvider" | "textModel" | "cloudFallbackMode" | "permissionMode">>,
): Promise<{ ok: boolean; message: string }> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.cloudEnabled !== undefined) updatePayload.cloud_enabled = patch.cloudEnabled;
  if (patch.defaultProvider !== undefined) updatePayload.default_provider = patch.defaultProvider;
  if (patch.textModel !== undefined) updatePayload.text_model = patch.textModel;
  if (patch.cloudFallbackMode !== undefined) updatePayload.cloud_fallback_mode = patch.cloudFallbackMode;
  if (patch.permissionMode !== undefined) updatePayload.permission_mode = patch.permissionMode;

  const { error } = await client
    .from("ai_preferences")
    .upsert(
      {
        user_id: userId,
        ...updatePayload,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[ai] update preferences error:", formatPostgrestErrorDiagnostic(error));
    return { ok: false, message: "Could not update AI preferences." };
  }

  return { ok: true, message: "AI preferences updated." };
}

/**
 * Prepares a minimized AI transfer request, evaluates consent, computes payload digest,
 * and records the metadata-only manifest in ai_transfer_requests.
 */
export async function prepareAiTransfer(
  input: RawContextInput,
  overrideProvider?: AiProviderId,
  overrideModel?: string,
): Promise<
  | {
      ok: true;
      manifest: AiTransferManifest;
      envelope: AiContextEnvelope;
      handleMap: EntityHandleMap;
      mode: "direct_prompt_send" | "needs_transfer_consent";
    }
  | { ok: false; message: string }
> {
  const { client } = await requireAuthenticatedSupabase();
  const preferences = await getAiPreferences();

  let minimized: ContextMinimizationResult;
  try {
    minimized = minimizeContext(input);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to minimize context.",
    };
  }

  const consentEval = evaluateTransferConsent(minimized.envelope, preferences);
  if (!consentEval.allowed) {
    return { ok: false, message: consentEval.reason };
  }

  const provider: AiProviderId =
    overrideProvider || preferences.defaultProvider || "anthropic";
  const descriptor = getModelDescriptor(provider, overrideModel || preferences.textModel || undefined);
  const digest = computePayloadDigest(minimized.envelope);

  // Call security-invoker RPC to prepare transfer metadata row
  const rpcRes = await client.rpc("ai_prepare_transfer_request", {
    p_provider: provider,
    p_model: descriptor.modelId,
    p_purpose: minimized.envelope.purpose,
    p_capability: "structured_output",
    p_data_classes: consentEval.dataClasses,
    p_source_count: minimized.envelope.items.length,
    p_text_byte_count: minimized.totalByteCount,
    p_image_byte_count: 0,
    p_allow_listed_fields: minimized.allowListedFields,
    p_source_references: minimized.sourceReferences,
    p_canonical_payload_digest: digest,
  });

  if (rpcRes.error || !rpcRes.data?.transfer_id) {
    if (rpcRes.error) {
      console.error("[ai] prepare transfer RPC error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    }
    return { ok: false, message: "Could not create AI transfer request." };
  }

  const transferId = rpcRes.data.transfer_id as string;
  const expiresAt = rpcRes.data.expires_at as string;

  const manifest: AiTransferManifest = {
    transferId,
    provider,
    model: descriptor.modelId,
    purpose: minimized.envelope.purpose,
    capability: "structured_output",
    dataClasses: consentEval.dataClasses,
    sourceCount: minimized.envelope.items.length,
    textByteCount: minimized.totalByteCount,
    imageByteCount: 0,
    allowListedFields: minimized.allowListedFields,
    sourceReferences: minimized.sourceReferences,
    canonicalPayloadDigest: digest,
    expiresAt,
  };

  return {
    ok: true,
    manifest,
    envelope: minimized.envelope,
    handleMap: minimized.handleMap,
    mode: consentEval.mode,
  };
}

/** Grants one-time user consent for the exact transfer ID. */
export async function grantAiTransferConsent(
  transferId: string,
): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireAuthenticatedSupabase();

  const rpcRes = await client.rpc("ai_grant_transfer_consent", {
    p_transfer_id: transferId,
  });

  if (rpcRes.error || !rpcRes.data?.ok) {
    const errCode = rpcRes.data?.error || "consent_failed";
    return { ok: false, message: `Could not grant consent: ${errCode}` };
  }

  return { ok: true, message: "Transfer consented." };
}

/**
 * Executes a consented transfer request against the cloud provider.
 * Enforces atomic claim, digest validation, response schema validation, and entity handle resolution.
 */
export async function dispatchAiTransfer(
  transferId: string,
  envelope: AiContextEnvelope,
  handleMap: EntityHandleMap,
): Promise<ValidatedAiProposalResult> {
  const { client, userId } = await requireAuthenticatedSupabase();

  // 1. Verify payload digest locally
  const currentDigest = computePayloadDigest(envelope);

  // 2. Atomic claim dispatch via RPC (moves consented -> dispatching)
  const claimRes = await client.rpc("ai_claim_transfer_dispatch", {
    p_transfer_id: transferId,
    p_canonical_payload_digest: currentDigest,
  });

  if (claimRes.error || !claimRes.data?.ok) {
    const errorMsg = claimRes.data?.error || "dispatch_claim_failed";
    throw new AiRepositoryError(`Could not claim AI transfer: ${errorMsg}`, errorMsg);
  }

  // 3. Fetch transfer metadata for provider and model
  const { data: transferData, error: fetchErr } = await client
    .from("ai_transfer_requests")
    .select("provider,model")
    .eq("id", transferId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !transferData) {
    throw new AiRepositoryError("Transfer record not found.");
  }

  const provider = transferData.provider as AiProviderId;
  const model = transferData.model as string;

  // 4. Format prompt
  const structuredPrompt = buildPromptWithContext(envelope);

  // 5. Call Provider Adapter
  let proposal: AiActionProposal;
  try {
    proposal = await executeCloudModelCall(provider, model, structuredPrompt);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Provider call failed";
    await client.rpc("ai_complete_transfer_request", {
      p_transfer_id: transferId,
      p_status: "failed",
      p_error_code: errorMsg.slice(0, 100),
      p_batch_id: null,
    });
    throw err;
  }

  // 6. Resolve request-bound handles to domain IDs
  const { resolvedActions, rejectedActions } = resolveActionHandles(proposal.actions, handleMap);

  if (rejectedActions.length > 0) {
    console.warn("[ai] rejected actions due to unmapped handles:", rejectedActions);
  }

  const validatedProposal = {
    schema_version: 1 as const,
    actions: resolvedActions,
  };

  // 7. If proposal contains mutating actions, persist reviewable operation_batch
  let batchId: string | null = null;
  const hasMutations = resolvedActions.some(isMutatingAiAction);

  if (hasMutations) {
    const summary = `AI proposal: ${envelope.purpose}`;
    batchId = await createProposedAiOperationBatch(transferId, resolvedActions, summary);
  }

  // 8. Mark transfer succeeded
  await client.rpc("ai_complete_transfer_request", {
    p_transfer_id: transferId,
    p_status: "succeeded",
    p_error_code: null,
    p_batch_id: batchId,
  });

  return {
    transferId,
    provider,
    model,
    proposal: validatedProposal,
    operationBatchId: batchId,
  };
}

/** Creates an owner-scoped proposed operation batch for review. */
export async function createProposedAiOperationBatch(
  transferId: string,
  actions: ProposedAiAction[],
  summary: string,
): Promise<string> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: batch, error: batchErr } = await client
    .from("operation_batches")
    .insert({
      user_id: userId,
      source: "ai",
      status: "proposed",
      summary,
      ai_transfer_request_id: transferId,
    })
    .select("id")
    .single();

  if (batchErr || !batch) {
    console.error("[ai] failed to create operation batch:", formatPostgrestErrorDiagnostic(batchErr));
    throw new AiRepositoryError("Could not create operation batch.");
  }

  const batchId = batch.id;
  const steps = actions.map((action, position) => {
    let targetEntity: string | null = null;
    let targetId: string | null = null;

    if ("task_id" in action && action.task_id) {
      targetEntity = "task";
      targetId = action.task_id;
    } else if ("entity_id" in action && action.entity_id) {
      targetEntity = "note";
      targetId = action.entity_id;
    }

    return {
      user_id: userId,
      batch_id: batchId,
      position,
      action_type: action.type,
      target_entity: targetEntity,
      target_id: targetId,
      input: action,
    };
  });

  if (steps.length > 0) {
    const { error: stepsErr } = await client.from("operation_steps").insert(steps);
    if (stepsErr) {
      console.error("[ai] failed to create operation steps:", formatPostgrestErrorDiagnostic(stepsErr));
    }
  }

  return batchId;
}

/** Cancels a pending transfer request. */
export async function cancelAiTransfer(
  transferId: string,
): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireAuthenticatedSupabase();

  const rpcRes = await client.rpc("ai_cancel_transfer_request", {
    p_transfer_id: transferId,
  });

  if (rpcRes.error) {
    console.error("[ai] cancel transfer error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    return { ok: false, message: "Could not cancel transfer." };
  }

  return { ok: true, message: "Transfer cancelled." };
}

/** Clears completed or failed transfer audit records for the user. */
export async function clearAiTransferHistory(): Promise<{ ok: boolean; message: string }> {
  const { client } = await requireAuthenticatedSupabase();

  const rpcRes = await client.rpc("ai_clear_transfer_history");
  if (rpcRes.error) {
    console.error("[ai] clear history error:", formatPostgrestErrorDiagnostic(rpcRes.error));
    return { ok: false, message: "Could not clear transfer history." };
  }

  return { ok: true, message: "AI transfer history cleared." };
}
