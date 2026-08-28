export const LOGIN_PATH = "/login";

export const SESSION_EXPIRED_REASON = "session-expired";

/**
 * `null` means "no session source is connected yet", which is the Phase 1G-A
 * presentation-only state. When Supabase session checks arrive, the guard
 * keeps the same decision shape; only the session source changes.
 */
export type WorkspaceSessionStatus = "authenticated" | "unauthenticated" | "expired";

export type WorkspaceAccessDecision =
  | { status: "allow" }
  | { status: "redirect"; path: string };

export function decideWorkspaceAccess(
  session: WorkspaceSessionStatus | null,
): WorkspaceAccessDecision {
  if (session === "expired") {
    return {
      status: "redirect",
      path: `${LOGIN_PATH}?reason=${SESSION_EXPIRED_REASON}`,
    };
  }
  if (session === "unauthenticated") {
    return { status: "redirect", path: LOGIN_PATH };
  }
  // `null` (no session source yet) and an authenticated session both allow.
  return { status: "allow" };
}

export type SignInField = "email" | "password" | null;

export type SignInFormState =
  | { status: "idle" }
  | { status: "error"; message: string; field: SignInField };

export const signInInitialState: SignInFormState = { status: "idle" };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignInFormResult =
  | { ok: true; email: string; password: string }
  | { ok: false; state: SignInFormState };

export function parseSignInForm(email: string, password: string): SignInFormResult {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return {
      ok: false,
      state: { status: "error", message: "Enter the email for your account.", field: "email" },
    };
  }
  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    return {
      ok: false,
      state: { status: "error", message: "Enter a valid email address.", field: "email" },
    };
  }
  if (!password) {
    return {
      ok: false,
      state: { status: "error", message: "Enter your password.", field: "password" },
    };
  }
  return { ok: true, email: trimmedEmail, password };
}

export type SignOutFormState =
  | { status: "idle" }
  | { status: "error"; message: string };

export const signOutInitialState: SignOutFormState = { status: "idle" };

export function isSessionExpiredNotice(reason: string | string[] | undefined): boolean {
  if (Array.isArray(reason)) {
    return reason.includes(SESSION_EXPIRED_REASON);
  }
  return reason === SESSION_EXPIRED_REASON;
}
