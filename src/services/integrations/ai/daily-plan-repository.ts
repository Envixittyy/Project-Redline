import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { AiTrustError } from "./trust-contract";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";
import {
  scopedFailure,
  readProductReview,
  recordInformationalReview,
} from "./scoped-product-repository";
import {
  DAILY_PLAN_ADVICE_CAPABILITY,
  parseDailyPlanAdviceOutput,
  type DailyPlanAdviceReview,
} from "./daily-plan-contract";
const capability = DAILY_PLAN_ADVICE_CAPABILITY.id;
export async function prepareDailyPlanAdvice(
  _input: unknown,
  provider: unknown,
  model: unknown,
) {
  const selection: unknown[] = [];
  const question = null;
  if (!validInferenceProvider(provider, model))
    throw new AiTrustError("invalid_provider");
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc(
    "ai_prepare_informational",
    signAiCommand(userId, "prepare_informational", {
      capability,
      selection,
      question,
      provider,
      model,
      time_zone: resolveTimeZone(),
    }),
  );
  if (result.error || typeof result.data !== "string")
    scopedFailure(result.error?.message);
  return { requestId: result.data as string };
}
export async function readDailyPlanAdviceReview(
  batchId: unknown,
): Promise<DailyPlanAdviceReview> {
  const r = await readProductReview(batchId, capability);
  return {
    ...r,
    advice: parseDailyPlanAdviceOutput(
      JSON.stringify(r.input),
      capability,
      r.sourceHandle,
    ),
  };
}
export async function finalizeDailyPlanAdvice(requestId: string, raw: unknown) {
  return readDailyPlanAdviceReview(
    await recordInformationalReview(
      requestId,
      capability,
      raw,
      parseDailyPlanAdviceOutput,
    ),
  );
}
