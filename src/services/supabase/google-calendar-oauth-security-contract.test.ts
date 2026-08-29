import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260829210000_google_calendar_oauth.sql");

describe("Google Calendar OAuth security contract", () => {
  it("stores only hashed state and encrypted PKCE material", () => {
    expect(migration).toContain("state_hash text primary key");
    expect(migration).toContain("encrypted_pkce_verifier text not null");
    expect(migration).not.toMatch(/\bstate text\b/);
    expect(migration).not.toMatch(/\bpkce_verifier text\b/);
    expect(migration).toContain("alter table public.calendar_oauth_states enable row level security");
  });

  it("binds start and callback to authenticated owner-scoped repositories", () => {
    const stateRepository = file("src/services/integrations/calendar/google-oauth-state-repository.ts");
    const callback = file("src/app/api/integrations/calendar/google/callback/route.ts");
    expect(stateRepository).toContain("requireAuthenticatedSupabase");
    expect(stateRepository).toContain('.delete()');
    expect(callback).toContain("consumeGoogleOAuthState(hashOAuthState(state))");
    expect(callback).not.toContain("request.nextUrl.origin");
  });

  it("keeps secrets server-only and requests read-only offline access", () => {
    const oauth = file("src/services/integrations/calendar/google-oauth.ts");
    expect(oauth).toContain("GOOGLE_CALENDAR_CLIENT_SECRET");
    expect(oauth).toContain("calendar.readonly");
    expect(oauth).toContain('"offline"');
    expect(oauth).toContain('"S256"');
    expect(oauth).not.toContain("NEXT_PUBLIC_GOOGLE");
  });
});
