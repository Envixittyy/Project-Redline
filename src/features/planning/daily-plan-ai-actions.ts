"use server";

import { prepareRoutedInference } from "@/services/integrations/ai/inference-router";

export async function prepareDailyPlanAdviceAction(
  context: {
    today: string;
    timeZone: string;
    tasks: Array<{ title: string; priority: string; dueDate?: string | null; estimatedMinutes?: number }>;
    events: Array<{ title: string; start: string; end: string; allDay: boolean }>;
    workloadScore?: number;
    workloadCategory?: string;
  },
  local: unknown,
) {
  return prepareRoutedInference("daily_plan_advice", JSON.stringify(context), local);
}

