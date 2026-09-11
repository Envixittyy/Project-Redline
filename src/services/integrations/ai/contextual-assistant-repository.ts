import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { resolveTimeZone } from "@/lib/date/day";
import { AiTrustError, uuid } from "./trust-contract";
import { strictJson, strictObject, strictText } from "./strict-output";
import { validInferenceProvider } from "./routing-contract";
import { signAiCommand } from "./trust-signing";
import {
  scopedFailure,
  readProductReview,
  recordInformationalReview,
} from "./scoped-product-repository";
import {
  CONTEXTUAL_ASSISTANT_CAPABILITY,
  parseContextualAssistantOutput,
  type ContextualAssistantReview,
} from "./contextual-assistant-contract";
const capability = CONTEXTUAL_ASSISTANT_CAPABILITY.id;
export async function prepareContextualAssistant(
  input: string,
  provider: unknown,
  model: unknown,
) {
  const p = strictObject(strictJson(input, 8192), [
    "entityType",
    "entityId",
    "question",
  ]);
  if (
    !["task", "course", "note", "course_material"].includes(
      p.entityType as string,
    )
  )
    throw new AiTrustError("request_unavailable");
  const selection = [
    {
      kind:
        p.entityType === "task"
          ? "context_task"
          : p.entityType === "course"
            ? "context_course"
            : p.entityType,
      id: uuid(p.entityId),
    },
  ];
  const question = strictText(p.question, 1000, true);
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
export async function readContextualAssistantReview(
  batchId: unknown,
): Promise<ContextualAssistantReview> {
  const r = await readProductReview(batchId, capability);
  const proposal = parseContextualAssistantOutput(
    JSON.stringify(r.input),
    capability,
    r.sourceHandle,
  );
  return { ...r, proposal, answer: proposal };
}
export async function finalizeContextualAssistant(
  requestId: string,
  raw: unknown,
) {
  return readContextualAssistantReview(
    await recordInformationalReview(
      requestId,
      capability,
      raw,
      parseContextualAssistantOutput,
    ),
  );
}
