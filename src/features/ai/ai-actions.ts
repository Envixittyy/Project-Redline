"use server";

import { revalidatePath } from "next/cache";

import {
  cancelAiTransfer,
  clearAiTransferHistory,
  dispatchAiTransfer,
  getAiPreferences,
  grantAiTransferConsent,
  prepareAiTransfer,
  updateAiPreferences,
} from "@/services/integrations/ai/ai-repository";
import type { ProposedAiAction } from "@/services/integrations/ai/action-contract";
import type {
  AiContextEnvelope,
  AiPreferences,
  AiProviderId,
  AiTransferManifest,
  ValidatedAiProposalResult,
} from "@/services/integrations/ai/types";
import type { RawContextInput } from "@/services/integrations/ai/context-minimizer";
import type { EntityHandleMap } from "@/services/integrations/ai/entity-handles";
import { createTask, updateTask } from "@/services/tasks/task-repository";
import { createNote } from "@/services/notes/note-repository";
import { createCalendarEvent } from "@/services/calendar-events/calendar-event-repository";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { authFailureMessage } from "@/services/supabase/errors";

function refresh() {
  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/notes");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath("/more");
  revalidatePath("/");
}

function handleActionResult(error: unknown): { ok: false; message: string } {
  const authMsg = authFailureMessage(error);
  if (authMsg) return { ok: false, message: authMsg };
  console.error("[ai-actions] error:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
  };
}

export async function getAiPreferencesAction(): Promise<
  { ok: true; preferences: AiPreferences } | { ok: false; message: string }
> {
  try {
    const preferences = await getAiPreferences();
    return { ok: true, preferences };
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function updateAiPreferencesAction(
  patch: Partial<Pick<AiPreferences, "cloudEnabled" | "defaultProvider" | "textModel" | "cloudFallbackMode" | "permissionMode">>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await updateAiPreferences(patch);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function prepareAiTransferAction(
  input: RawContextInput,
  provider?: AiProviderId,
  model?: string,
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
    return await prepareAiTransfer(input, provider, model);
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function grantAiTransferConsentAction(
  transferId: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof transferId !== "string" || !transferId.trim()) {
      return { ok: false, message: "A valid transfer ID is required." };
    }
    return await grantAiTransferConsent(transferId.trim());
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function dispatchAiTransferAction(
  transferId: unknown,
  envelope: unknown,
  handleMap: unknown,
): Promise<
  | { ok: true; result: ValidatedAiProposalResult }
  | { ok: false; message: string }
> {
  try {
    if (typeof transferId !== "string" || !transferId.trim()) {
      return { ok: false, message: "A valid transfer ID is required." };
    }
    const res = await dispatchAiTransfer(
      transferId.trim(),
      envelope as AiContextEnvelope,
      handleMap as EntityHandleMap,
    );
    refresh();
    return { ok: true, result: res };
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function cancelAiTransferAction(
  transferId: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof transferId !== "string" || !transferId.trim()) {
      return { ok: false, message: "A valid transfer ID is required." };
    }
    return await cancelAiTransfer(transferId.trim());
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function clearAiTransferHistoryAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await clearAiTransferHistory();
    if (res.ok) refresh();
    return res;
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function applyAiProposalAction(
  batchId: unknown,
  actions: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    const actionList = (Array.isArray(actions) ? actions : []) as ProposedAiAction[];

    for (const action of actionList) {
      switch (action.type) {
        case "create_task":
          await createTask({
            title: action.title,
            dueAt: action.due_at || null,
            priority: (action.priority as "low" | "medium" | "high") || "medium",
          });
          break;
        case "update_task":
          await updateTask(action.task_id, {
            title: action.title,
            dueAt: action.due_at,
            priority: (action.priority as "low" | "medium" | "high" | undefined),
          });
          break;
        case "complete_task":
          await updateTask(action.task_id, {
            status: "completed",
          });
          break;
        case "create_note":
          await createNote({
            title: action.title,
            body: action.body || "",
            taskId: null,
            courseId: null,
          });
          break;
        case "create_event":
          await createCalendarEvent({
            title: action.title,
            start: action.starts_at,
            end: action.ends_at,
            allDay: false,
            eventType: "event",
          });
          break;
      }
    }

    if (typeof batchId === "string" && batchId.trim()) {
      await client
        .from("operation_batches")
        .update({
          status: "committed",
          committed_at: new Date().toISOString(),
        })
        .eq("id", batchId.trim())
        .eq("user_id", userId);
    }

    refresh();
    return { ok: true, message: "AI proposal applied successfully." };
  } catch (error) {
    return handleActionResult(error);
  }
}

export async function rejectAiProposalAction(
  batchId: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    if (typeof batchId === "string" && batchId.trim()) {
      await client
        .from("operation_batches")
        .update({
          status: "rejected",
        })
        .eq("id", batchId.trim())
        .eq("user_id", userId);
    }

    refresh();
    return { ok: true, message: "AI proposal dismissed." };
  } catch (error) {
    return handleActionResult(error);
  }
}
