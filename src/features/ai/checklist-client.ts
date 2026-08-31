"use client";
import type { LocalCompanionConfig } from "@/services/integrations/ai/types";
import type { ChecklistReview } from "@/services/integrations/ai/trust-contract";
import type { InferenceProvenance } from "@/services/integrations/ai/routing-contract";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import { generateRoutedProposal } from "./routing-client";

/** Explicit Generate action only. Provider routing cannot apply the proposal. */
export async function generateTaskChecklist(taskId: string, config: LocalCompanionConfig | null = getCompanionSession(), signal?: AbortSignal) {
  const result = await generateRoutedProposal("checklist", taskId, config, signal);
  return result.ok ? { ...result, review: result.review as ChecklistReview & { provenance: InferenceProvenance } } : result;
}
