import { describe, expect, it } from "vitest";

import {
  AuthenticationRequiredError,
  authFailureMessage,
  formatPostgrestErrorDiagnostic,
  postgrestErrorDiagnostic,
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

  it("keeps PostgREST diagnostics enumerable for server logs", () => {
    expect(
      postgrestErrorDiagnostic({
        code: "PGRST205",
        message: "Could not find the table in the schema cache",
        details: "The table is missing.",
        hint: "Apply the committed migrations.",
      }),
    ).toEqual({
      code: "PGRST205",
      message: "Could not find the table in the schema cache",
      details: "The table is missing.",
      hint: "Apply the committed migrations.",
    });
  });

  it("formats PostgREST diagnostics as one development-safe log value", () => {
    expect(
      formatPostgrestErrorDiagnostic({
        code: "PGRST205",
        message: "Could not find public.tasks",
        details: null,
        hint: null,
      }),
    ).toBe(
      '{"code":"PGRST205","message":"Could not find public.tasks","details":null,"hint":null}',
    );
  });
});
