"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { signOutInitialState, type SignOutFormState } from "./auth-domain";
import { privacySafeSignOutAction } from "./privacy-actions";

import styles from "./sign-out-control.module.css";

export function SignOutControl() {
  const [state, formAction, isPending] = useActionState<SignOutFormState>(
    privacySafeSignOutAction,
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
