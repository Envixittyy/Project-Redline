import "server-only";

import { redirect } from "next/navigation";

import { decideWorkspaceAccess, type WorkspaceSessionStatus } from "./auth-domain";

export type AuthOutcome = { ok: true } | { ok: false; message: string };

/**
 * Phase 1G-A presentation boundary. Real sign-in arrives in a later phase as
 * `supabase.auth.signInWithPassword`; until then every attempt reports that
 * account sign-in is not connected yet instead of faking a session.
 */
export async function authenticateUser(): Promise<AuthOutcome> {
  return {
    ok: false,
    message: "Account sign-in isn't connected yet. It arrives with Supabase session support.",
  };
}

/**
 * Phase 1G-A presentation boundary. Real sign-out arrives in a later phase as
 * `supabase.auth.signOut`.
 */
export async function endUserSession(): Promise<AuthOutcome> {
  return {
    ok: false,
    message: "Account sign-out isn't connected yet, so there's no session to end on this device.",
  };
}

/**
 * Session source for the workspace guard. A later phase points this at
 * `supabase.auth.getSession()`. `null` means "no session source connected
 * yet" and the guard allows access so the workspace stays usable during the
 * presentation-only phase.
 */
export async function readWorkspaceSession(): Promise<WorkspaceSessionStatus | null> {
  return null;
}

export async function requireWorkspaceAccess(): Promise<void> {
  const session = await readWorkspaceSession();
  const decision = decideWorkspaceAccess(session);
  if (decision.status === "redirect") {
    redirect(decision.path);
  }
}
