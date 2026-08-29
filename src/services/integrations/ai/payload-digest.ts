import { createHash } from "node:crypto";

import type { AiContextEnvelope } from "./types";

/**
 * Computes a deterministic SHA-256 hash of an AiContextEnvelope.
 * Keys in all nested objects are sorted alphabetically to prevent serialization divergence.
 */
export function computePayloadDigest(envelope: AiContextEnvelope): string {
  const canonicalString = JSON.stringify(envelope, (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });

  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/** Validates that a string is a valid 64-character SHA-256 hex digest. */
export function isValidDigest(digest: string): boolean {
  return typeof digest === "string" && /^[a-f0-9]{64}$/i.test(digest);
}
