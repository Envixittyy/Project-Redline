"use client";
import type { LocalCompanionConfig } from "./types";

// Tab-memory only. Reload closes the local session from the browser's perspective;
// restart/unpair/expiry revokes daemon authority. Never use localStorage or cookies.
let session: { config: LocalCompanionConfig; expiresAt: number } | null = null;
export function setCompanionSession(
  config: LocalCompanionConfig,
  expiresAt: string,
) {
  if (typeof window === "undefined" || !Number.isFinite(Date.parse(expiresAt)))
    return;
  session = { config: { ...config }, expiresAt: Date.parse(expiresAt) };
}
export function getCompanionSession(): LocalCompanionConfig | null {
  if (
    typeof window === "undefined" ||
    !session ||
    session.expiresAt <= Date.now()
  ) {
    session = null;
    return null;
  }
  return { ...session.config };
}
export function clearCompanionSession() {
  session = null;
}
