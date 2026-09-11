import "server-only";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { LocalProviderType } from "./types";
import type { CloudProvider } from "./routing-contract";
import { cloudModel } from "./cloud-provider";
import { AiTrustError } from "./trust-contract";
import { signAiCommand } from "./trust-signing";

export type ModelModality = "text" | "vision" | "unknown";

/** Cloud authority is exact server-owned model configuration, never a name heuristic. */
export function cloudModelModality(provider: CloudProvider): { model: string; modality: ModelModality } {
  const model = cloudModel(provider);
  const configured = provider === "gemini" ? process.env.GEMINI_MODEL_MODALITY : process.env.OPENROUTER_MODEL_MODALITY;
  return { model, modality: configured === "vision" ? "vision" : configured === "text" ? "text" : "unknown" };
}

export async function saveLocalModelConfiguration(provider: unknown, model: unknown, supportsImage: unknown) {
  if (!(["ollama", "llamacpp", "openai_compatible"] as unknown[]).includes(provider) || typeof model !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model) || typeof supportsImage !== "boolean" ||
      (provider === "llamacpp" && supportsImage)) throw new AiTrustError("invalid_model_configuration");
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_save_local_model_configuration", signAiCommand(userId, "save_local_model_configuration", {
    provider, model, supports_image: supportsImage,
  }));
  if (result.error || typeof result.data !== "string") throw new AiTrustError("model_configuration_unavailable");
  return result.data as string;
}

export async function localModelModality(provider: LocalProviderType, model: string): Promise<ModelModality> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("ai_model_configurations").select("supports_image,status")
    .eq("user_id", userId).eq("provider", provider).eq("model", model).maybeSingle();
  if (error || !data || data.status !== "active") return "unknown";
  return data.supports_image === true ? "vision" : "text";
}
