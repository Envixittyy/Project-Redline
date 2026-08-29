import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applicationOrigin,
  createGoogleAuthorizationRequest,
  googleCalendarRedirectUri,
  hashOAuthState,
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
});
