import { describe, expect, it } from "vitest";

import {
  AuthenticationRequiredError,
  authFailureMessage,
  SupabaseTemporarilyUnavailableError,
} from "./errors";

describe("safe authenticated action errors", () => {
  it("returns safe missing and expired session messages", () => {
    expect(authFailureMessage(new AuthenticationRequiredError("missing"))).toBe(
      "Sign in to continue.",
    );
    expect(authFailureMessage(new AuthenticationRequiredError("expired"))).toBe(
      "Your session expired. Sign in again to continue.",
    );
  });

  it("does not expose provider internals for an outage", () => {
    expect(authFailureMessage(new SupabaseTemporarilyUnavailableError())).toBe(
      "The account service is temporarily unavailable. Please try again.",
    );
    expect(authFailureMessage(new Error("secret provider detail"))).toBeNull();
  });
});
