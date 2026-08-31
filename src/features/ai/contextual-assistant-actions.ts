"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";

export async function prepareContextualAssistantAction(
  payload: {
    entityType: "task" | "course" | "note" | "course_material";
    entityId: string;
    question: string;
  },
  local: unknown,
) {
  return prepareRoutedInference(
    "contextual_assistant",
    JSON.stringify(payload),
    local,
  );
}

