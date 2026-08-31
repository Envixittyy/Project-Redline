import { AiTrustError } from "./trust-contract";

/** Validate without trimming, coercing, filtering or silently dropping fields. */
export function strictObject(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    required.some(key => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new AiTrustError("invalid_output");
  }
  return value as Record<string, unknown>;
}

export function strictText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max ||
    (multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) ||
    // Reject lone UTF-16 surrogates, which PostgreSQL JSON cannot represent.
    !value.isWellFormed()) throw new AiTrustError("invalid_output");
  return value;
}

export function strictJson(raw: unknown, bytes: number): unknown {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > bytes) {
    throw new AiTrustError("output_too_large");
  }
  try { return JSON.parse(raw); } catch { throw new AiTrustError("invalid_output"); }
}

export function strictDate(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    throw new AiTrustError("invalid_output");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AiTrustError("invalid_output");
  }
  return value;
}
