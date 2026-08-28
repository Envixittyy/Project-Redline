import "server-only";

import { redirect, unstable_rethrow } from "next/navigation";

import { decideWorkspaceAccess, type WorkspaceSessionStatus } from "./auth-domain";
import {
  AuthenticationRequiredError,
  SupabaseNotConfiguredError,
  SupabaseTemporarilyUnavailableError,
} from "@/services/supabase/errors";
import {
  createRequestSupabaseClient,
  requireAuthenticatedSupabase,
} from "@/services/supabase/request";
import { isTemporarySupabaseAuthError } from "@/services/supabase/session-domain";

export type AuthOutcome = { ok: true } | { ok: false; message: string };

export async function authenticateUser(email: string, password: string): Promise<AuthOutcome> {
  try {
    const client = await createRequestSupabaseClient();
    const { error } = await client.auth.signInWithPassword({ email, password });

    if (!error) return { ok: true };
    if (isTemporarySupabaseAuthError(error)) {
      return { ok: false, message: "The account service is temporarily unavailable. Try again." };
    }
    return { ok: false, message: "The email or password is incorrect." };
  } catch (error) {
    if (error instanceof SupabaseNotConfiguredError) {
      return { ok: false, message: "Supabase Auth is not configured for this application." };
    }
    console.error("[auth] sign in failed:", error);
    return { ok: false, message: "The account service is temporarily unavailable. Try again." };
  }
}

export async function endUserSession(): Promise<AuthOutcome> {
  try {
    const client = await createRequestSupabaseClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (!error) return { ok: true };

    console.error("[auth] sign out failed:", error);
    return { ok: false, message: "Could not sign out this device. Please try again." };
  } catch (error) {
    console.error("[auth] sign out failed:", error);
    return { ok: false, message: "Could not sign out this device. Please try again." };
  }
}

export async function readWorkspaceSession(): Promise<WorkspaceSessionStatus> {
  try {
    await requireAuthenticatedSupabase();
    return "authenticated";
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthenticationRequiredError) {
      return error.reason === "expired" ? "expired" : "unauthenticated";
    }
    if (error instanceof SupabaseNotConfiguredError) return "unauthenticated";
    if (error instanceof SupabaseTemporarilyUnavailableError) return "unavailable";

    console.error("[auth] session verification failed:", error);
    return "unavailable";
  }
}

export async function requireWorkspaceAccess(): Promise<void> {
  const session = await readWorkspaceSession();
  const decision = decideWorkspaceAccess(session);
  if (decision.status === "redirect") {
    redirect(decision.path);
  }
}
