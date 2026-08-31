"use client";
import { inferLocalContent } from "@/services/integrations/ai/companion-client";
import type { LocalCompanionConfig } from "@/services/integrations/ai/types";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import {
  finalizeTaskChecklistAction,
  prepareTaskChecklistAction,
} from "./checklist-actions";

/** Invoke only from the user's labelled Generate checklist action. Does not apply. */
export async function generateTaskChecklist(
  taskId: string,
  config: LocalCompanionConfig | null = getCompanionSession(),
  signal?: AbortSignal,
) {
  if (!config)
    return {
      ok: false as const,
      code: "not_paired",
      message: "Pair the companion on this PC first.",
    };
  try {
    const prepared = await prepareTaskChecklistAction(
      taskId,
      config.provider,
      config.model,
    );
    if (!prepared.ok) return prepared;
    if (signal?.aborted)
      return {
        ok: false as const,
        code: "cancelled",
        message: "AI request cancelled.",
      };
    const raw = await inferLocalContent(
      config,
      prepared.prepared.inference,
      signal,
    );
    if (signal?.aborted)
      return {
        ok: false as const,
        code: "cancelled",
        message: "AI request cancelled.",
      };
    return await finalizeTaskChecklistAction(prepared.prepared.requestId, raw);
  } catch {
    return {
      ok: false as const,
      code: "companion_unavailable",
      message: "Local AI unavailable. No task changes were made.",
    };
  }
}
