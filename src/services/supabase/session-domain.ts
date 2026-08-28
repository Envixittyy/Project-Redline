export type ClaimsLike = { sub?: unknown; email?: unknown } | null | undefined;

type AuthErrorLike = {
  name?: unknown;
  status?: unknown;
  code?: unknown;
};

export function isTemporarySupabaseAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as AuthErrorLike;
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const code = typeof candidate.code === "string" ? candidate.code : "";

  return (
    status === 0 ||
    (status !== null && status >= 500) ||
    name === "AuthRetryableFetchError" ||
    code === "unexpected_failure"
  );
}

export function authenticatedSubject(claims: ClaimsLike): string | null {
  return typeof claims?.sub === "string" && claims.sub.length > 0 ? claims.sub : null;
}

export function authCookieStorageKey(supabaseUrl: string): string | null {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export function hasSupabaseAuthCookie(cookieNames: string[], supabaseUrl: string): boolean {
  const storageKey = authCookieStorageKey(supabaseUrl);
  return storageKey ? cookieNames.some((name) => name === storageKey || name.startsWith(`${storageKey}.`)) : false;
}
