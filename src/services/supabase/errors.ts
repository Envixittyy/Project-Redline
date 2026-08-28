export type AuthenticationFailureReason = "missing" | "expired";

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
