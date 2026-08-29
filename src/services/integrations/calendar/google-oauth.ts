import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { encryptCredential } from "@/services/integrations/credential";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export class GoogleCalendarConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarConfigurationError";
  }
}

type GoogleTokenCredential = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  tokenType: "Bearer";
};

function required(name: "APP_ORIGIN" | "GOOGLE_CALENDAR_CLIENT_ID" | "GOOGLE_CALENDAR_CLIENT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleCalendarConfigurationError(`${name} is not configured.`);
  return value;
}

export function applicationOrigin(): string {
  const raw = required("APP_ORIGIN");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GoogleCalendarConfigurationError("APP_ORIGIN must be an absolute URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new GoogleCalendarConfigurationError("APP_ORIGIN must contain only the application origin.");
  }
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new GoogleCalendarConfigurationError("APP_ORIGIN must use HTTPS outside local development.");
  }
  return url.origin;
}

export function googleCalendarRedirectUri(): string {
  return `${applicationOrigin()}/api/integrations/calendar/google/callback`;
}

export function isGoogleCalendarOAuthConfigured(): boolean {
  try {
    required("GOOGLE_CALENDAR_CLIENT_ID");
    required("GOOGLE_CALENDAR_CLIENT_SECRET");
    applicationOrigin();
    return Boolean(process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY);
  } catch {
    return false;
  }
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function createGoogleAuthorizationRequest(): {
  authorizationUrl: URL;
  encryptedVerifier: string;
  expiresAt: string;
  state: string;
  stateHash: string;
} {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
  const authorizationUrl = new URL(AUTHORIZE_ENDPOINT);
  authorizationUrl.searchParams.set("client_id", required("GOOGLE_CALENDAR_CLIENT_ID"));
  authorizationUrl.searchParams.set("redirect_uri", googleCalendarRedirectUri());
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", READ_ONLY_SCOPE);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return {
    authorizationUrl,
    encryptedVerifier: encryptCredential(verifier),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    state,
    stateHash: hashOAuthState(state),
  };
}

function tokenField(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Google token response omitted ${field}.`);
  }
  return value;
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  verifier: string,
): Promise<{ encryptedCredential: string; expiresAt: string }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("GOOGLE_CALENDAR_CLIENT_ID"),
      client_secret: required("GOOGLE_CALENDAR_CLIENT_SECRET"),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: googleCalendarRedirectUri(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error("Google authorization code exchange failed.");
  }
  const record = payload as Record<string, unknown>;
  const expiresIn = record.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Google token response omitted a valid expiry.");
  }
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const tokenType = tokenField(record.token_type, "token_type");
  if (tokenType.toLowerCase() !== "bearer") {
    throw new Error("Google token response returned an unsupported token type.");
  }
  const credential: GoogleTokenCredential = {
    version: 1,
    accessToken: tokenField(record.access_token, "access_token"),
    refreshToken: tokenField(record.refresh_token, "refresh_token"),
    expiresAt,
    scope: tokenField(record.scope, "scope"),
    tokenType: "Bearer",
  };
  return { encryptedCredential: encryptCredential(JSON.stringify(credential)), expiresAt };
}
