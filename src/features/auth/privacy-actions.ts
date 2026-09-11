"use client";

import { clearSensitivePwaState } from "@/lib/offline/pwa-privacy";

import { signInAction, signOutAction } from "./auth-actions";
import type { SignInFormState, SignOutFormState } from "./auth-domain";

export async function privacySafeSignInAction(
  previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  await clearSensitivePwaState();
  return signInAction(previous, formData);
}

export async function privacySafeSignOutAction(
  previous: SignOutFormState,
): Promise<SignOutFormState> {
  await clearSensitivePwaState();
  return signOutAction(previous);
}
