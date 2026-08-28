import type { PostgrestError } from "@supabase/supabase-js";

export type AuthenticationFailureReason = "missing" | "expired";

export type PostgrestErrorDiagnostic = {
  code: PostgrestError["code"];
  message: PostgrestError["message"];
  details: PostgrestError["details"] | null;
  hint: PostgrestError["hint"] | null;
};

/**
 * Copy PostgREST's useful fields into an enumerable value for server logs.
 * Framework error serialization can otherwise reduce the provider error to `{}`.
 */
export function postgrestErrorDiagnostic(
  error: PostgrestErrorDiagnostic,
): PostgrestErrorDiagnostic {
  return {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  };
}

/** A single string survives Next.js development-console forwarding intact. */
export function formatPostgrestErrorDiagnostic(error: PostgrestErrorDiagnostic): string {
  return JSON.stringify(postgrestErrorDiagnostic(error));
}

export class SupabaseNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Supabase is not configured. Missing environment variable(s): ${missing.join(", ")}.`);
    this.name = "SupabaseNotConfiguredError";
  }
}

export class AuthenticationRequiredError extends Error {
  readonly reason: AuthenticationFailureReason;

  constructor(reason: AuthenticationFailureReason) {
    super(reason === "expired" ? "The authenticated session has expired." : "Authentication is required.");
    this.name = "AuthenticationRequiredError";
    this.reason = reason;
  }
}

export class SupabaseTemporarilyUnavailableError extends Error {
  constructor() {
    super("Supabase authentication is temporarily unavailable.");
    this.name = "SupabaseTemporarilyUnavailableError";
  }
}

export function authFailureMessage(error: unknown): string | null {
  if (error instanceof AuthenticationRequiredError) {
    return error.reason === "expired"
      ? "Your session expired. Sign in again to continue."
      : "Sign in to continue.";
  }

  if (error instanceof SupabaseTemporarilyUnavailableError) {
    return "The account service is temporarily unavailable. Please try again.";
  }

  return null;
}
