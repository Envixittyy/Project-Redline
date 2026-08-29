import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260829220000_google_calendar_sync.sql");

describe("Google Calendar sync security contract", () => {
  it("keeps refresh operations owner-scoped and security-invoker", () => {
    expect(migration.match(/security invoker/g)).toHaveLength(3);
    expect(migration.match(/account\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(3);
    expect(migration).toContain("revoke all on function public.claim_google_calendar_refresh");
    expect(migration).toContain("to authenticated");
  });

  it("binds completion and failure to the exact live lease", () => {
    expect(migration.match(/account\.refresh_lock_until = expected_lock_until/g)).toHaveLength(2);
    expect(migration).toContain("account.refresh_lock_until >= now()");
    expect(migration).toContain("new_lock_until > now() + interval '2 minutes'");
  });

  it("never serializes provider credentials into the sync action response", () => {
    const action = file("src/features/integrations/google-calendar-actions.ts");
    expect(action).toContain("runGoogleCalendarSync");
    expect(action).not.toContain("encryptedCredential");
    expect(action).not.toContain("accessToken");
    expect(action).not.toContain("refreshToken");
  });

  it("gates synchronization on the account and adapter capability contracts", () => {
    const sync = file("src/services/integrations/calendar/google-calendar-sync.ts");
    const page = file("src/app/(workspace)/integrations/calendars/page.tsx");
    expect(sync).toContain("hasCalendarCapabilities(account.capabilities");
    expect(sync).toContain('requireCalendarCapability(provider, "list_calendars")');
    expect(sync).toContain('requireCalendarCapability(provider, "list_events")');
    expect(page).toContain("connection.capabilities");
  });
});
