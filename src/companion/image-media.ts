import { createHash } from "node:crypto";

import type { LocalInferenceRequest } from "./types";
import { LocalAdapterError } from "./adapters/runtime-adapter";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = 6_990_508;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/** Validates the only binary shape adapters accept. URLs and paths are not representable. */
export function validatedImageMedia(request: LocalInferenceRequest): string | undefined {
  if (request.images !== undefined) {
    throw new LocalAdapterError("Legacy image input is forbidden.", "unsupported_modality");
  }
  if (request.media === undefined) return undefined;
  if (!Array.isArray(request.media) || request.media.length !== 1) {
    throw new LocalAdapterError("Invalid image media.", "unsupported_modality");
  }

  const item = request.media[0];
  if (
    !item ||
    Object.keys(item).length !== 4 ||
    item.type !== "image" ||
    item.mimeType !== "image/png" ||
    typeof item.base64 !== "string" ||
    item.base64.length > MAX_BASE64_LENGTH ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(item.base64) ||
    typeof item.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.digest)
  ) {
    throw new LocalAdapterError("Invalid image media.", "unsupported_modality");
  }

  const bytes = Buffer.from(item.base64, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString("base64") !== item.base64 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    throw new LocalAdapterError("Invalid image media.", "unsupported_modality");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== item.digest) {
    throw new LocalAdapterError("Image digest mismatch.", "unsupported_modality");
  }
  return item.base64;
}
