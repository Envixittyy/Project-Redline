"use server";

import { redirect } from "next/navigation";

import {
  LOGIN_PATH,
  parseSignInForm,
  type SignOutFormState,
  type SignInFormState,
} from "./auth-domain";
import { authenticateUser, endUserSession } from "./auth-session";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signInAction(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const parsed = parseSignInForm(
    stringField(formData, "email"),
    stringField(formData, "password"),
  );
  if (!parsed.ok) {
    return parsed.state;
  }

  // Phase 1G-A: input is validated for presentation only; the boundary is
  // not wired to Supabase yet.
  const outcome = await authenticateUser();
  if (outcome.ok) {
    redirect("/");
  }
  return { status: "error", message: outcome.message, field: null };
}

export async function signOutAction(_previous: SignOutFormState): Promise<SignOutFormState> {
  const outcome = await endUserSession();
  if (outcome.ok) {
    redirect(LOGIN_PATH);
  }
  return { status: "error", message: outcome.message };
}
