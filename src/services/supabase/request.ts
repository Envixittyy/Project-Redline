import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  AuthenticationRequiredError,
  SupabaseTemporarilyUnavailableError,
} from "./errors";
import { readPublicSupabaseConfig } from "./public-config";
import {
  authenticatedSubject,
  hasSupabaseAuthCookie,
  isTemporarySupabaseAuthError,
} from "./session-domain";

export type AuthenticatedSupabaseContext = {
  client: SupabaseClient;
  userId: string;
  email: string | null;
};

/** A fresh cookie-backed client must be created for every server request. */
export async function createRequestSupabaseClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = readPublicSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes
          // them before rendering; Server Actions can write them here.
        }
      },
    },
  });
}

export async function requireAuthenticatedSupabase(): Promise<AuthenticatedSupabaseContext> {
  const { url } = readPublicSupabaseConfig();
  const cookieStore = await cookies();
  const hadAuthCookie = hasSupabaseAuthCookie(
    cookieStore.getAll().map(({ name }) => name),
    url,
  );
  const client = await createRequestSupabaseClient();
  const { data, error } = await client.auth.getClaims();

  if (error) {
    if (isTemporarySupabaseAuthError(error)) {
      throw new SupabaseTemporarilyUnavailableError();
    }
    throw new AuthenticationRequiredError(hadAuthCookie ? "expired" : "missing");
  }

  const userId = authenticatedSubject(data?.claims);
  if (!userId) {
    throw new AuthenticationRequiredError(hadAuthCookie ? "expired" : "missing");
  }

  return {
    client,
    userId,
    email: typeof data?.claims?.email === "string" ? data.claims.email : null,
  };
}
