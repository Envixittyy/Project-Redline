import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260828230000_blackboard_sync_notifications.sql");

describe("Phase 2 security contract", () => {
  it("owner-scopes every integration and notification table", () => {
    for (const table of [
      "integration_accounts",
      "sync_runs",
      "external_records",
      "sync_changes",
      "announcements",
      "devices",
      "push_subscriptions",
      "notification_preferences",
      "notification_events",
      "notification_deliveries",
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("(select auth.uid())=user_id");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("encrypts credentials and never stores a plaintext feed field", () => {
    const credential = file("src/services/integrations/credential.ts");
    expect(credential).toContain("aes-256-gcm");
    expect(credential).toContain("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY");
    expect(migration).toContain("encrypted_credential text not null");
    expect(migration).not.toContain("feed_url");
  });

  it("prevents concurrent account sync and deduplicates records and notifications", () => {
    expect(migration).toContain("sync_runs_one_active_per_account");
    expect(migration).toContain("external_records_account_uid unique(account_id,external_uid)");
    expect(migration).toContain(
      "notification_events_owner_dedupe unique(user_id,dedupe_key)",
    );
  });
});
