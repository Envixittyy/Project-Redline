"use server";
import { revalidatePath } from "next/cache";
import {
  cancelAiTransfer,
  clearAiTransferHistory,
  getAiPreferences,
  updateAiPreferences,
} from "@/services/integrations/ai/ai-repository";
import {
  approveTaskChecklist,
  rejectTaskChecklist,
} from "@/services/integrations/ai/checklist-repository";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type {
  AiContextEnvelope,
  AiPreferences,
  AiProviderId,
  AiTransferManifest,
  ValidatedAiProposalResult,
} from "@/services/integrations/ai/types";
import type { RawContextInput } from "@/services/integrations/ai/context-minimizer";
import type { EntityHandleMap } from "@/services/integrations/ai/entity-handles";

function failure() {
  return {
    ok: false as const,
    message:
      "AI operation unavailable. No unreviewed changes were applied. Refresh and check AI setup and task state.",
  };
}
function refresh() {
  for (const path of ["/tasks", "/calendar", "/", "/settings/ai"])
    revalidatePath(path);
}
export async function getAiPreferencesAction() {
  try {
    return { ok: true as const, preferences: await getAiPreferences() };
  } catch {
    return failure();
  }
}
export async function updateAiPreferencesAction(
  patch: Partial<
    Pick<
      AiPreferences,
      | "cloudEnabled"
      | "defaultProvider"
      | "textModel"
      | "cloudFallbackMode"
      | "permissionMode"
    >
  >,
) {
  try {
    const result = await updateAiPreferences(patch);
    if (result.ok) refresh();
    return result;
  } catch {
    return failure();
  }
}

// Compatibility endpoints for the existing Notes UI. The former browser-authored
// context/handle/operation path is deliberately disabled, before any provider egress.
export async function prepareAiTransferAction(
  _input: RawContextInput,
  _provider?: AiProviderId,
  _model?: string,
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
  try {
    await requireAuthenticatedSupabase();
  } catch {
    return failure();
  }
  return {
    ok: false,
    message:
      "Cloud AI is paused until its context and consent flow uses the new trust boundary. Local task-checklist proposals have a separate scoped API.",
  };
}
export async function grantAiTransferConsentAction(_id: unknown) {
  try {
    await requireAuthenticatedSupabase();
  } catch {
    return failure();
  }
  return { ok: false, message: "Legacy cloud transfers are disabled." };
}
export async function dispatchAiTransferAction(
  _id: unknown,
  _envelope?: unknown,
  _handles?: unknown,
): Promise<
  | { ok: true; result: ValidatedAiProposalResult }
  | { ok: false; message: string }
> {
  try {
    await requireAuthenticatedSupabase();
  } catch {
    return failure();
  }
  return {
    ok: false,
    message: "Legacy cloud transfers are disabled. Nothing was sent.",
  };
}
export async function cancelAiTransferAction(id: unknown) {
  try {
    if (typeof id !== "string") return failure();
    return await cancelAiTransfer(id);
  } catch {
    return failure();
  }
}
export async function clearAiTransferHistoryAction() {
  try {
    return await clearAiTransferHistory();
  } catch {
    return failure();
  }
}
/** The sole approval input is a persisted batch ID. No browser operation array. */
export async function applyAiProposalAction(batchId: unknown) {
  try {
    const result = await approveTaskChecklist(batchId);
    refresh();
    return result.ok
      ? { ok: true, message: "Reviewed checklist applied." }
      : {
          ok: false,
          message:
            "Task changed since generation. Review the updated task and generate a new checklist.",
        };
  } catch {
    return failure();
  }
}
export async function rejectAiProposalAction(batchId: unknown) {
  try {
    await rejectTaskChecklist(batchId);
    refresh();
    return { ok: true, message: "Proposal dismissed." };
  } catch {
    return failure();
  }
}
