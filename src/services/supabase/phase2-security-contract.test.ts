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
    const credential = file("src/services/integrations/blackboard/credential.ts");
    expect(credential).toContain("aes-256-gcm");
    expect(credential).toContain("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY");
    expect(migration).toContain("encrypted_credential text not null");
    expect(migration).not.toContain("feed_url");
  });

  it("pins validated DNS and never exposes a generic fetch proxy", () => {
    const source = file("src/services/integrations/blackboard/safe-fetch.ts");
    expect(source).toContain("lookup: createPinnedLookup");
    expect(source).toMatch(/MAX_REDIRECTS\s*=\s*3/);
    expect(source).toMatch(/MAX_BYTES\s*=\s*2_000_000/);
    expect(source).toContain("if (options.all)");
    expect(source).not.toMatch(/export async function[\s\S]*\(.*url.*\)[\s\S]*fetch\(/);
  });

  it("prevents concurrent account sync and deduplicates records and notifications", () => {
    expect(migration).toContain("sync_runs_one_active_per_account");
    expect(migration).toContain("external_records_account_uid unique(account_id,external_uid)");
    expect(migration).toContain(
      "notification_events_owner_dedupe unique(user_id,dedupe_key)",
    );
  });

  it("keeps Blackboard records source-aware instead of auto-creating tasks", () => {
    const repository = file(
      "src/services/integrations/blackboard/blackboard-repository.ts",
    );
    const syncDomain = file("src/services/integrations/blackboard/sync-domain.ts");

    expect(repository).not.toMatch(/from\s+["']@\/services\/tasks\/task-repository["']/);
    expect(repository).not.toContain("createTask(");
    expect(repository).not.toContain("updateTask(");
    expect(syncDomain).not.toContain("taskPatch");
  });
});
