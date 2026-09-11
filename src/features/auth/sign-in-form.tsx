"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { signInInitialState, type SignInFormState } from "./auth-domain";
import { privacySafeSignInAction } from "./privacy-actions";

import styles from "./sign-in-form.module.css";

export function SignInForm() {
  const [state, formAction, isPending] = useActionState<SignInFormState, FormData>(
    privacySafeSignInAction,
    signInInitialState,
  );

  const emailInvalid = state.status === "error" && state.field === "email";
  const passwordInvalid = state.status === "error" && state.field === "password";

  return (
    <form className={styles.form} action={formAction}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="signin-email">
          Email
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          aria-invalid={emailInvalid}
          className={emailInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="signin-password">
          Password
        </label>
        <input
          id="signin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          aria-invalid={passwordInvalid}
          className={
            passwordInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input
          }
        />
      </div>
      {state.status === "error" ? (
        <Callout tone="error" title="Sign in failed">
          {state.message}
        </Callout>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={isPending}
        disabled={isPending}
        className={styles.submit}
      >
        Sign in
      </Button>
    </form>
  );
}
