import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applicationOrigin,
  createGoogleAuthorizationRequest,
  googleCalendarRedirectUri,
  hashOAuthState,
  parseGoogleTokenCredential,
  refreshGoogleTokenCredential,
} from "./google-oauth";

const original = {
  origin: process.env.APP_ORIGIN,
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  encryption: process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY,
};

beforeEach(() => {
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (original.origin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = original.origin;
  if (original.clientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
  else process.env.GOOGLE_CALENDAR_CLIENT_ID = original.clientId;
  if (original.clientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = original.clientSecret;
  if (original.encryption === undefined) delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = original.encryption;
});

describe("Google Calendar OAuth", () => {
  it("creates a narrow, offline, PKCE-protected authorization request", () => {
    const request = createGoogleAuthorizationRequest();
    expect(request.authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(request.authorizationUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(request.authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(request.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.authorizationUrl.searchParams.get("state")).toBe(request.state);
    expect(request.stateHash).toBe(hashOAuthState(request.state));
    expect(request.encryptedVerifier).not.toContain(request.state);
  });

  it("uses one exact callback and refuses an unsafe production origin", () => {
    expect(applicationOrigin()).toBe("http://localhost:3000");
    expect(googleCalendarRedirectUri()).toBe(
      "http://localhost:3000/api/integrations/calendar/google/callback",
    );
    process.env.APP_ORIGIN = "http://forward.example.com";
    expect(() => applicationOrigin()).toThrow("HTTPS");
  });

  it("refreshes the access token without replacing the long-lived refresh token", async () => {
    const credential = {
      version: 1 as const,
      accessToken: "old-access",
      refreshToken: "long-lived-refresh",
      expiresAt: "2026-08-29T00:00:00.000Z",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      tokenType: "Bearer" as const,
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: "new-access",
      expires_in: 3600,
      token_type: "Bearer",
    }), { status: 200 }));
    const result = await refreshGoogleTokenCredential(credential, request);
    const stored = parseGoogleTokenCredential(result.encryptedCredential);
    expect(stored.accessToken).toBe("new-access");
    expect(stored.refreshToken).toBe("long-lived-refresh");
    expect(result.encryptedCredential).not.toContain("new-access");
    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
  });
});
