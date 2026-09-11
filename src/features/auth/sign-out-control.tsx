"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={isPending}
        disabled={isPending}
      >
        Sign out of this device
      </Button>
      {state.status === "error" ? (
        <Callout tone="error" title="Sign out failed">
          {state.message}
        </Callout>
      ) : null}
    </form>
  );
}
