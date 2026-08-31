"use client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type { CourseImportReview } from "@/services/integrations/ai/course-import-contract";
import type { InferenceProvenance } from "@/services/integrations/ai/routing-contract";
import { generateRoutedProposal } from "./routing-client";

/** Selected upload only. No provider-specific business logic or mutation. */
export async function generateCourseImport(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.set("file", file);
  const result = await generateRoutedProposal("course", form, getCompanionSession(), signal);
  return result.ok ? { ...result, review: result.review as CourseImportReview & { provenance: InferenceProvenance } } : result;
}
