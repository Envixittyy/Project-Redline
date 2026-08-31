"use client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import { inferLocalContent } from "@/services/integrations/ai/companion-client";
import {
  finalizeCourseImportAction,
  prepareCourseImportAction,
} from "./course-import-actions";

/** Explicit user-selected upload only. This function never applies a proposal. */
export async function generateCourseImport(file: File, signal?: AbortSignal) {
  const config = getCompanionSession();
  if (!config)
    return {
      ok: false as const,
      message: "Pair the companion in AI Settings on this PC first.",
    };
  try {
    const form = new FormData();
    form.set("file", file);
    const prepared = await prepareCourseImportAction(
      form,
      config.provider,
      config.model,
    );
    if (!prepared.ok) return prepared;
    if (signal?.aborted) throw new Error("cancelled");
    const raw = await inferLocalContent(
      config,
      prepared.prepared.inference,
      signal,
    );
    if (signal?.aborted) throw new Error("cancelled");
    return await finalizeCourseImportAction(prepared.prepared.requestId, raw);
  } catch {
    return {
      ok: false as const,
      message:
        "Local course import cancelled or unavailable. No course was created.",
    };
  }
}
