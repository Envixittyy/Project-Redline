import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
        <h1>Sign in</h1>
        <p>
          {configured
            ? "Use your Supabase account to open your private workspace."
            : "Supabase Auth must be configured before this private workspace can be opened."}
        </p>
      </header>
      {isSessionExpiredNotice(params.reason) ? (
        <p role="status" className={styles.notice}>
          Your session expired. Sign in to continue where you left off.
        </p>
      ) : null}
      {isAuthUnavailableNotice(params.reason) ? (
        <p role="status" className={styles.notice}>
          The account service is temporarily unavailable. Please try again.
        </p>
      ) : null}
      <SignInForm />
    </div>
  );
}
