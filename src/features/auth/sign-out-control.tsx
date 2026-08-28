"use client";

import { useActionState } from "react";

import { signOutAction } from "./auth-actions";
import { signOutInitialState, type SignOutFormState } from "./auth-domain";

import styles from "./sign-out-control.module.css";

export function SignOutControl() {
  const [state, formAction, isPending] = useActionState<SignOutFormState>(
    signOutAction,
    signOutInitialState,
  );

  return (
    <form className={styles.control} action={formAction}>
      <button type="submit" className={styles.button} disabled={isPending}>
        {isPending ? "Signing out…" : "Sign out of this device"}
      </button>
      {state.status === "error" ? (
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
