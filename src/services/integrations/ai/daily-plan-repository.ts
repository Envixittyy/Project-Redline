import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import {
  DAILY_PLAN_ADVICE_CAPABILITY,
  dailyPlanAdvicePrompt,
  parseDailyPlanAdviceOutput,
  type DailyPlanAdviceReview,
} from "./daily-plan-contract";
import { AiTrustError, uuid } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";

export async function prepareDailyPlanAdvice(
  contextPayload: string,
  provider: unknown,
  model: unknown,
) {
  const { client, userId } = await requireAuthenticatedSupabase();
  if (!validInferenceProvider(provider, model) || typeof model !== "string") {
    throw new AiTrustError("invalid_provider");
  }

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
  const handle = `plan_${randomUUID().replaceAll("-", "")}`;
  const promptData = dailyPlanAdvicePrompt(handle, context);
  const sourceText = JSON.stringify(promptData);
  const sourceDigest = createHash("sha256").update(sourceText).digest("hex");
  const timeZone = resolveTimeZone();
  const startDate = todayIn(timeZone);

  const { error } = await client.rpc(
    "ai_create_scoped_request",
    signAiCommand(userId, "prepare_scoped_request", {
      id: requestId,
      capability: DAILY_PLAN_ADVICE_CAPABILITY.id,
      source_handle: handle,
      source_digest: sourceDigest,
      source_text: sourceText,
      file_name: `daily_plan_${context.today || startDate}.json`,
      start_date: startDate,
      time_zone: timeZone,
      provider,
      model,
    }),
  );

  if (error) throw new AiTrustError("request_not_prepared");

  return {
    requestId,
    handle,
    promptData,
    payloadDigest: sourceDigest,
    bytes: Buffer.byteLength(sourceText),
  };
}

async function loadReview(batchId: unknown) {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("ai_read_scoped_review", {
    p_batch_id: uuid(batchId),
  });
  if (error || !data) throw new AiTrustError("untrusted_proposal");
  const proposal = parseDailyPlanAdviceOutput(
    JSON.stringify(data.input),
    data.capability,
    data.sourceHandle,
  );
  if (!/^[a-f0-9]{64}$/.test(data.proposalDigest)) {
    throw new AiTrustError("untrusted_proposal");
  }
  return { ...data, advice: proposal } as DailyPlanAdviceReview & {
    proposalDigest: string;
    sourceHandle: string;
  };
}

export async function readDailyPlanAdviceReview(
  batchId: unknown,
): Promise<DailyPlanAdviceReview> {
  const r = await loadReview(batchId);
  return {
    batchId: r.batchId,
    advice: r.advice,
    status: r.status,
    sourceHandle: r.sourceHandle,
    provenance: r.provenance,
  };
}

export async function finalizeDailyPlanAdvice(
  requestId: string,
  rawOutput: unknown,
): Promise<DailyPlanAdviceReview> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data: request, error: reqError } = await client
    .from("ai_scoped_requests")
    .select("id,source_handle,file_name,status,source_text,source_digest,capability,expires_at")
    .eq("id", uuid(requestId))
    .eq("user_id", userId)
    .maybeSingle();

  if (
    reqError ||
    !request ||
    request.status !== "prepared" ||
    Date.parse(request.expires_at) <= Date.now()
  ) {
    throw new AiTrustError("request_unavailable");
  }

  if (createHash("sha256").update(request.source_text).digest("hex") !== request.source_digest) {
    throw new AiTrustError("source_changed");
  }

  const proposal = parseDailyPlanAdviceOutput(rawOutput, request.capability, request.source_handle);

  const result = await client.rpc(
    "ai_record_scoped_proposal",
    signAiCommand(userId, "record_scoped_proposal", {
      request_id: request.id,
      proposal,
      summary: "Daily Planning Advice",
      target_entity: "daily_plan",
    }),
  );

  if (result.error || typeof result.data !== "string") {
    throw new AiTrustError("proposal_not_recorded");
  }

  return readDailyPlanAdviceReview(result.data);
}
