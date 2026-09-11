"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";

export async function prepareDailyPlanAdviceAction(
  _context: unknown,
  local: unknown,
) {
  // Context is constructed strictly and canonically on the server from database state.
  return prepareRoutedInference("daily_plan_advice", null, local);
}
