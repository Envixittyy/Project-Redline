import { describe, expect, it } from "vitest";

import {
  decideWorkspaceAccess,
  AUTH_UNAVAILABLE_REASON,
  isAuthUnavailableNotice,
  isSessionExpiredNotice,
  parseSignInForm,
  signInInitialState,
  signOutInitialState,
  SESSION_EXPIRED_REASON,
} from "./auth-domain";

describe("decideWorkspaceAccess", () => {
  it("allows an authenticated session", () => {
    expect(decideWorkspaceAccess("authenticated")).toEqual({ status: "allow" });
  });

  it("redirects an unauthenticated session to the login route", () => {
    expect(decideWorkspaceAccess("unauthenticated")).toEqual({
      status: "redirect",
      path: "/login",
    });
  });

  it("redirects an expired session to the login route with a reason", () => {
    expect(decideWorkspaceAccess("expired")).toEqual({
      status: "redirect",
      path: `/login?reason=${SESSION_EXPIRED_REASON}`,
    });
  });

  it("fails closed when the auth service is unavailable", () => {
    expect(decideWorkspaceAccess("unavailable")).toEqual({
      status: "redirect",
      path: `/login?reason=${AUTH_UNAVAILABLE_REASON}`,
    });
  });
});

describe("parseSignInForm", () => {
  it("accepts a usable email and password", () => {
    expect(parseSignInForm("  aquilo@example.com ", "hunter22")).toEqual({
      ok: true,
      email: "aquilo@example.com",
      password: "hunter22",
    });
  });

  it("rejects a missing email with a field-level state", () => {
    const result = parseSignInForm("   ", "hunter22");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toEqual({
        status: "error",
        message: "Enter the email for your account.",
        field: "email",
      });
    }
  });

  it("rejects an invalid email", () => {
    const result = parseSignInForm("not-an-email", "hunter22");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toEqual({
        status: "error",
        message: "Enter a valid email address.",
        field: "email",
      });
    }
  });

  it("rejects a missing password", () => {
    const result = parseSignInForm("aquilo@example.com", "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toEqual({
        status: "error",
        message: "Enter your password.",
        field: "password",
      });
    }
  });
});

describe("initial form states", () => {
  it("start idle", () => {
    expect(signInInitialState).toEqual({ status: "idle" });
    expect(signOutInitialState).toEqual({ status: "idle" });
  });
});

describe("isSessionExpiredNotice", () => {
  it("recognizes the expired reason in scalar and array forms", () => {
    expect(isSessionExpiredNotice(SESSION_EXPIRED_REASON)).toBe(true);
    expect(isSessionExpiredNotice([SESSION_EXPIRED_REASON])).toBe(true);
  });

  it("ignores other reasons", () => {
    expect(isSessionExpiredNotice("unknown")).toBe(false);
    expect(isSessionExpiredNotice(undefined)).toBe(false);
  });
});

describe("isAuthUnavailableNotice", () => {
  it("recognizes the unavailable reason without confusing it for expiry", () => {
    expect(isAuthUnavailableNotice(AUTH_UNAVAILABLE_REASON)).toBe(true);
    expect(isAuthUnavailableNotice([AUTH_UNAVAILABLE_REASON])).toBe(true);
    expect(isAuthUnavailableNotice(SESSION_EXPIRED_REASON)).toBe(false);
  });
});
