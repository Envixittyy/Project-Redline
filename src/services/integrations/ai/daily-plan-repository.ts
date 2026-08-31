import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  DAILY_PLAN_ADVICE_CAPABILITY,
  dailyPlanAdvicePrompt,
  parseDailyPlanAdviceOutput,
} from "./daily-plan-contract";
import { AiTrustError, uuid } from "./trust-contract";

export async function prepareDailyPlanAdvice(
  contextPayload: string,
  provider: string,
  model: string,
) {
  const { client, userId } = await requireAuthenticatedSupabase();

  let context: {
    today: string;
    timeZone: string;
    tasks: Array<{ title: string; priority: string; dueDate?: string | null; estimatedMinutes?: number }>;
    events: Array<{ title: string; start: string; end: string; allDay: boolean }>;
    workloadScore?: number;
    workloadCategory?: string;
  };

  try {
    context = JSON.parse(contextPayload);
  } catch {
    throw new AiTrustError("request_unavailable");
  }

  const requestId = randomUUID();
  const handle = `plan_${randomUUID()}`;
  const promptData = dailyPlanAdvicePrompt(handle, context);
  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await client.from("ai_course_requests").insert({
    id: requestId,
    user_id: userId,
    capability: DAILY_PLAN_ADVICE_CAPABILITY.id,
    source_handle: handle,
    file_name: `daily_plan_${context.today}.json`,
    source_text: sourceText,
    source_digest: sourceDigest,
    start_date: context.today,
    timeZone: context.timeZone,
    provider,
    model,
    status: "prepared",
    expires_at: expiresAt,
  });

  if (error) throw new AiTrustError("request_unavailable");

  return {
    requestId,
    handle,
    promptData,
    payloadDigest: sourceDigest,
    bytes: Buffer.byteLength(sourceText),
    expiresAt,
  };
}

export async function finalizeDailyPlanAdvice(
  requestId: string,
  rawOutput: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: request, error: reqError } = await client
    .from("ai_course_requests")
    .select("id,source_handle,file_name,status,expires_at,capability")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();

  if (reqError || !request || request.status !== "prepared") {
    throw new AiTrustError("request_unavailable");
  }

  const proposal = parseDailyPlanAdviceOutput(rawOutput, request.capability, request.source_handle);
  const batchId = randomUUID();

  await client.from("operation_batches").insert({
    id: batchId,
    user_id: userId,
    source: "ai",
    status: "proposed",
    ai_course_request_id: request.id,
  });

  await client.from("operation_steps").insert({
    id: randomUUID(),
    batch_id: batchId,
    user_id: userId,
    position: 0,
    action_type: request.capability,
    input: proposal as Record<string, unknown>,
  });

  return {
    batchId,
    proposal,
    status: "proposed",
    sourceHandle: request.source_handle,
  };
}
