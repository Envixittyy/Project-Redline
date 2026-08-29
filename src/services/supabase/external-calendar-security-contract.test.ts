import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260829200000_external_calendar_platform.sql");

describe("P3 external-calendar platform contract", () => {
  it("owner-scopes accounts, calendars, and provider event mirrors", () => {
    for (const table of [
      "external_calendar_accounts",
      "external_calendars",
      "external_calendar_events",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("guards cross-table ownership and encryptable token fields", () => {
    expect(migration).toMatch(/if tg_table_name = 'external_calendars' then[\s\S]*new\.account_id/);
    expect(migration).toMatch(/elsif tg_table_name = 'external_calendar_events' then[\s\S]*new\.calendar_id/);
    expect(migration).toContain("encrypted_credential text");
    expect(migration).toContain("encrypted_sync_token text");
    expect(migration).not.toMatch(/access_token\s+text/i);
    expect(migration).not.toMatch(/refresh_token\s+text/i);
  });

  it("keeps provider identity separate from native calendar events", () => {
    const repository = file("src/services/external-calendars/external-calendar-repository.ts");
    expect(repository).toContain('.from("external_calendar_events")');
    expect(repository).not.toContain('.from("calendar_events").insert');
    expect(repository).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    const statusRead = repository.slice(
      repository.indexOf("export async function listExternalCalendarConnections"),
      repository.indexOf("export async function saveGoogleCalendarConnection"),
    );
    expect(statusRead).not.toContain("encrypted_credential");
  });
});
