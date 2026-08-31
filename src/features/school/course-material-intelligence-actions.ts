"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";

export async function prepareCourseMaterialSummaryAction(
  materialIds: string[],
  local: unknown,
) {
  return prepareRoutedInference(
    "material_summary",
    JSON.stringify({ materialIds }),
    local,
  );
}

export async function prepareCourseMaterialStudyQuestionsAction(
  materialIds: string[],
  local: unknown,
) {
  return prepareRoutedInference(
    "material_study_questions",
    JSON.stringify({ materialIds }),
    local,
  );
}

