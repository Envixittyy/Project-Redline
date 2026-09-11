import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import {
  isAuthUnavailableNotice,
  isSessionExpiredNotice,
} from "@/features/auth/auth-domain";
import { readWorkspaceSession } from "@/features/auth/auth-session";
import { SignInForm } from "@/features/auth/sign-in-form";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

import styles from "./login-page.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const session = await readWorkspaceSession();
  if (session === "authenticated") redirect("/");
  const configured = isSupabaseConfigured();

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Private Workspace</p>
        <h1>Sign in</h1>
        <p className={styles.description}>
          {configured
            ? "Use your Supabase account to open your private workspace."
            : "Supabase Auth must be configured before this private workspace can be opened."}
        </p>
      </header>
      {!configured ? (
        <Callout tone="warning" title="Configuration Required">
          Supabase Auth environment variables are not configured.
        </Callout>
      ) : null}
      {isSessionExpiredNotice(params.reason) ? (
        <Callout tone="warning" title="Session Expired">
          Your session expired. Sign in to continue where you left off.
        </Callout>
      ) : null}
      {isAuthUnavailableNotice(params.reason) ? (
        <Callout tone="error" title="Service Unavailable">
          The account service is temporarily unavailable. Please try again.
        </Callout>
      ) : null}
      <SignInForm />
    </div>
  );
}
