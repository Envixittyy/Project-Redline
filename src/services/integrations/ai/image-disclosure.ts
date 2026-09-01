import "server-only";
import { createHash } from "node:crypto";
import { validateImageBuffer } from "@/services/documents/image-validator";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { isModelId, validateCompanionUrl, validateLoopbackUrl } from "@/companion/network-policy";
import { validateConfiguredOrigin } from "@/companion/security";
import { signCompanionTicket, ticketDigest, type CompanionCapability } from "@/companion/request-ticket";
import type { LocalInferenceRequest } from "@/companion/types";
import { cloudModelModality, localModelModality } from "./model-modality";
import { AiTrustError, uuid } from "./trust-contract";
import { signAiCommand } from "./trust-signing";
import type { CloudProvider, InferenceLocation } from "./routing-contract";
import type { LocalProviderType } from "./types";
import { inferCloud } from "./cloud-provider";

export const IMAGE_CAPABILITIES = ["schoolScheduleImage.propose", "blackboardCourseImage.propose", "academicCalendarImport.propose"] as const;
export type ImageCapability = typeof IMAGE_CAPABILITIES[number];
export type ImageRoute =
  | { provider: LocalProviderType; model: string; location: Exclude<InferenceLocation, "cloud"> }
  | { provider: CloudProvider; model: string; location: "cloud" };
export type ClaimedImage = {
  disclosureId: string; capability: ImageCapability; provider: ImageRoute["provider"]; model: string;
  location: InferenceLocation; mimeType: "image/png"; base64: string; digest: string;
  byteCount: number; width: number; height: number; expiresAt: string;
  disclosureFields: ["normalized_image"];
};

function capability(value: unknown): ImageCapability {
  if (typeof value !== "string" || !IMAGE_CAPABILITIES.includes(value as ImageCapability)) throw new AiTrustError("capability_denied");
  return value as ImageCapability;
}
function digest(base64: string) { return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"); }

export async function createValidatedImageSource(file: File, requestedCapability: unknown) {
  const selectedCapability = capability(requestedCapability);
  const normalized = await validateImageBuffer(Buffer.from(await file.arrayBuffer()), file.name, file.type);
  const normalizedDigest = digest(normalized.base64);
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_create_validated_image", signAiCommand(userId, "create_validated_image", {
    capability: selectedCapability, normalized_base64: normalized.base64, normalized_digest: normalizedDigest,
    normalized_byte_count: normalized.byteLength, width: normalized.width, height: normalized.height,
  }));
  if (result.error || typeof result.data !== "string") throw new AiTrustError("image_source_unavailable");
  return { imageId: result.data as string, capability: selectedCapability, digest: normalizedDigest,
    mimeType: normalized.mimeType as "image/png", byteCount: normalized.byteLength, width: normalized.width, height: normalized.height };
}

export async function prepareImageDisclosure(imageId: unknown, requestedCapability: unknown, route: ImageRoute) {
  const selectedCapability = capability(requestedCapability);
  let modalitySource: "saved_local_configuration" | "server_cloud_configuration";
  if (route.location === "cloud") {
    const configured = cloudModelModality(route.provider as CloudProvider);
    if (configured.model !== route.model || configured.modality !== "vision") throw new AiTrustError("unsupported_modality");
    modalitySource = "server_cloud_configuration";
  } else {
    if (route.provider === "llamacpp" || await localModelModality(route.provider, route.model) !== "vision") throw new AiTrustError("unsupported_modality");
    modalitySource = "saved_local_configuration";
  }
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_prepare_image_disclosure", signAiCommand(userId, "prepare_image_disclosure", {
    image_id: uuid(imageId), capability: selectedCapability, provider: route.provider, model: route.model,
    location: route.location, modality_source: modalitySource,
  }));
  if (result.error || typeof result.data !== "string") throw new AiTrustError(result.error?.message?.includes("privacy") ? "cloud_privacy_denied" : "disclosure_unavailable");
  return { disclosureId: result.data as string, requiresConsent: route.location === "cloud" };
}

export async function consentImageDisclosure(disclosureId: unknown) {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("ai_consent_image_disclosure", signAiCommand(userId, "consent_image_disclosure", { disclosure_id: uuid(disclosureId) }));
  if (error) throw new AiTrustError("disclosure_unavailable");
}

export async function claimImageDisclosure(disclosureId: unknown): Promise<ClaimedImage> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const result = await client.rpc("ai_claim_image_disclosure", signAiCommand(userId, "claim_image_disclosure", { disclosure_id: uuid(disclosureId) }));
  const data = result.data as ClaimedImage | null;
  if (result.error || !data || data.mimeType !== "image/png" || digest(data.base64) !== data.digest ||
      Buffer.from(data.base64, "base64").length !== data.byteCount || !IMAGE_CAPABILITIES.includes(data.capability) ||
      data.disclosureFields?.length !== 1 || data.disclosureFields[0] !== "normalized_image" || !isModelId(data.model))
    throw new AiTrustError("disclosure_unavailable");
  return data;
}

export async function finishImageDisclosure(disclosureId: unknown, status: "succeeded" | "failed") {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.rpc("ai_finish_image_disclosure", signAiCommand(userId, "finish_image_disclosure", {
    disclosure_id: uuid(disclosureId), status,
  }));
  if (error) throw new AiTrustError("disclosure_unavailable");
}

export function inferenceWithClaimedImage(claimed: ClaimedImage, input: Omit<LocalInferenceRequest, "model" | "images" | "media">): LocalInferenceRequest {
  return { ...input, model: claimed.model, media: [{ type: "image", mimeType: "image/png", base64: claimed.base64, digest: claimed.digest }] };
}

export async function dispatchCloudImageDisclosure(disclosureId: unknown, input: Omit<LocalInferenceRequest, "model" | "images" | "media">) {
  const claimed = await claimImageDisclosure(disclosureId);
  if (claimed.location !== "cloud" || !["gemini", "openrouter"].includes(claimed.provider)) throw new AiTrustError("capability_denied");
  try {
    const output = await inferCloud(claimed.provider as CloudProvider, inferenceWithClaimedImage(claimed, input));
    await finishImageDisclosure(claimed.disclosureId, "succeeded");
    return output;
  } catch (error) {
    await finishImageDisclosure(claimed.disclosureId, "failed");
    throw error;
  }
}

/** Signs the exact local/remote-local body; changing any byte invalidates the ticket. */
export async function signClaimedImageCompanionRequest(claimed: ClaimedImage, input: Omit<LocalInferenceRequest, "model" | "images" | "media">,
  transport: { companionUrl: string; endpoint: string; pairingToken: string; deviceId: string }) {
  if (claimed.location === "cloud" || !["ollama", "openai_compatible"].includes(claimed.provider)) throw new AiTrustError("capability_denied");
  const { userId } = await requireAuthenticatedSupabase();
  const key = process.env.COMPANION_REQUEST_SIGNING_KEY, origin = process.env.APP_ORIGIN;
  const companionUrl = validateCompanionUrl(transport.companionUrl).origin;
  const expectedAudience = claimed.location === "remote_local" ? process.env.NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN : (process.env.COMPANION_LOCAL_ORIGIN || "http://127.0.0.1:41400");
  if (!key || !origin || !expectedAudience || companionUrl !== expectedAudience || !validateConfiguredOrigin(origin) ||
      !/^fwd_comp_[a-f0-9]{64}$/.test(transport.pairingToken)) throw new AiTrustError("companion_auth_not_configured");
  const body = { provider: claimed.provider, endpoint: validateLoopbackUrl(transport.endpoint).toString(), request: inferenceWithClaimedImage(claimed, input) };
  const ticket = signCompanionTicket(key, { audience: expectedAudience, origin, userId, deviceId: uuid(transport.deviceId),
    path: "/v1/infer", bodyDigest: ticketDigest(body), tokenHash: ticketDigest(transport.pairingToken), capability: claimed.capability as CompanionCapability });
  return { body, ticket };
}
