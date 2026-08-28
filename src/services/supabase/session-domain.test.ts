import { describe, expect, it } from "vitest";

import {
  authenticatedSubject,
  authCookieStorageKey,
  hasSupabaseAuthCookie,
  isTemporarySupabaseAuthError,
} from "./session-domain";

describe("Supabase session classification", () => {
  it("accepts only a non-empty subject claim", () => {
    expect(authenticatedSubject({ sub: "user-a" })).toBe("user-a");
    expect(authenticatedSubject({ sub: "" })).toBeNull();
    expect(authenticatedSubject({ sub: 42 })).toBeNull();
    expect(authenticatedSubject(null)).toBeNull();
  });

  it("recognizes retryable provider failures without treating credential errors as outages", () => {
    expect(isTemporarySupabaseAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(isTemporarySupabaseAuthError({ status: 503 })).toBe(true);
    expect(isTemporarySupabaseAuthError({ code: "unexpected_failure" })).toBe(true);
    expect(isTemporarySupabaseAuthError({ status: 400, code: "invalid_credentials" })).toBe(false);
  });

  it("detects normal and chunked SSR auth cookies for the configured project", () => {
    const url = "https://project-ref.supabase.co";
    expect(authCookieStorageKey(url)).toBe("sb-project-ref-auth-token");
    expect(hasSupabaseAuthCookie(["sb-project-ref-auth-token"], url)).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-project-ref-auth-token.0"], url)).toBe(true);
    expect(hasSupabaseAuthCookie(["theme"], url)).toBe(false);
    expect(hasSupabaseAuthCookie(["sb-other-auth-token"], url)).toBe(false);
  });
});
