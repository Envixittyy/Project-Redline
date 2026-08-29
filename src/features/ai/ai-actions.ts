"use server";

import { revalidatePath } from "next/cache";

import {
  cancelAiTransfer,
  clearAiTransferHistory,
  createProposedAiOperationBatch,
  dispatchAiTransfer,
  getAiPreferences,
  grantAiTransferConsent,
  prepareAiTransfer,
  updateAiPreferences,
} from "@/services/integrations/ai/ai-repository";
import {
  isMutatingAiAction,
  type ProposedAiAction,
} from "@/services/integrations/ai/action-contract";
import type {
  AiContextEnvelope,
  AiPreferences,
  AiProviderId,
  AiTransferManifest,
  LocalCompanionConfig,
  LocalCompanionStatus,
  ValidatedAiProposalResult,
} from "@/services/integrations/ai/types";
import {
  minimizeContext,
  type RawContextInput,
} from "@/services/integrations/ai/context-minimizer";
import {
  buildPromptWithContext,
  resolveActionHandles,
  type EntityHandleMap,
} from "@/services/integrations/ai/entity-handles";
import {
  checkCompanionHealth,
  executeLocalInference,
  getCompanionStatus,
  pairCompanion,
  type CompanionHealthResponse,
  type CompanionPairResult,
} from "@/services/integrations/ai/companion-client";
import { createTask, deleteTask, updateTask } from "@/services/tasks/task-repository";
import { createNote } from "@/services/notes/note-repository";
import { createCourse } from "@/services/courses/course-repository";
import { createCalendarEvent } from "@/services/calendar-events/calendar-event-repository";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { authFailureMessage } from "@/services/supabase/errors";

function refresh() {
  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/notes");
  revalidatePath("/calendar");
  revalidatePath("/school");
  revalidatePath("/focus");
  revalidatePath("/more");
  revalidatePath("/settings/ai");
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

export async function checkCompanionHealthAction(
  url?: string,
): Promise<CompanionHealthResponse> {
  return await checkCompanionHealth(url);
}

export async function pairCompanionAction(
  companionUrl: string,
  pairingSecret: string,
): Promise<CompanionPairResult> {
  return await pairCompanion(companionUrl, pairingSecret);
}

export async function getCompanionStatusAction(
  config: LocalCompanionConfig,
): Promise<LocalCompanionStatus> {
  return await getCompanionStatus(config);
}

export async function dispatchLocalAiAction(
  config: LocalCompanionConfig,
  input: RawContextInput,
): Promise<
  | { ok: true; result: ValidatedAiProposalResult }
  | { ok: false; message: string }
> {
  try {
    const minimized = minimizeContext(input);
    const structuredPrompt = buildPromptWithContext(minimized.envelope);

    const proposal = await executeLocalInference(
      config,
      structuredPrompt,
      minimized.envelope,
    );

    const { resolvedActions, rejectedActions } = resolveActionHandles(
      proposal.actions,
      minimized.handleMap,
    );

    if (rejectedActions.length > 0) {
      console.warn("[ai-local] rejected actions due to unmapped handles:", rejectedActions);
    }

    const validatedProposal = {
      schema_version: 1 as const,
      actions: resolvedActions,
    };

    let batchId: string | null = null;
    const hasMutations = resolvedActions.some(isMutatingAiAction);

    if (hasMutations) {
      const summary = `Local AI (${config.provider}): ${minimized.envelope.purpose}`;
      // Fallback local transfer identifier for operation_batches
      batchId = await createProposedAiOperationBatch(
        `local_${Date.now()}`,
        resolvedActions,
        summary,
      );
    }

    refresh();
    return {
      ok: true,
      result: {
        transferId: `local_${Date.now()}`,
        provider: config.provider,
        model: config.model,
        proposal: validatedProposal,
        operationBatchId: batchId,
      },
    };
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
            courseId: action.course_id || null,
          });
          break;
        case "update_task":
          await updateTask(action.task_id, {
            title: action.title,
            dueAt: action.due_at,
            priority: (action.priority as "low" | "medium" | "high" | undefined),
            courseId: action.course_id,
          });
          break;
        case "complete_task":
          await updateTask(action.task_id, {
            status: "completed",
          });
          break;
        case "delete_task":
          await deleteTask(action.task_id);
          break;
        case "reschedule_task":
          await updateTask(action.task_id, {
            scheduledStart: action.starts_at,
            scheduledEnd: action.ends_at,
          });
          break;
        case "create_note":
          await createNote({
            title: action.title,
            body: action.body || "",
            taskId: action.task_id || null,
            courseId: action.course_id || null,
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
        case "propose_course":
          await createCourse({
            code: action.code,
            name: action.name,
            instructor: action.instructor || null,
            location: action.location || null,
            color: action.color || null,
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
