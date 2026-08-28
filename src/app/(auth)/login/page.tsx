import type { Metadata } from "next";

import { isSessionExpiredNotice } from "@/features/auth/auth-domain";
import { SignInForm } from "@/features/auth/sign-in-form";

import styles from "./login-page.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>Sign in</h1>
        <p>
          Account sign-in isn&apos;t connected yet. This page previews how sign-in and
          sign-out will behave once Supabase session support arrives.
        </p>
      </header>
      {isSessionExpiredNotice(params.reason) ? (
        <p role="status" className={styles.notice}>
          Your session expired. Sign in to continue where you left off.
        </p>
      ) : null}
      <SignInForm />
    </div>
  );
}
