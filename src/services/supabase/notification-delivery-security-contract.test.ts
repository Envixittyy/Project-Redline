import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260830130000_notification_delivery_hardening.sql",
  "utf8",
);

describe("notification delivery database security contract", () => {
  it("enforces owner equality across notification relationships", () => {
    expect(migration).toContain("existing notification relationship owner mismatch");
    expect(migration).toContain("push subscription device owner mismatch");
    expect(migration).toContain("notification preference course owner mismatch");
    expect(migration).toContain("notification event course owner mismatch");
    expect(migration).toContain("notification delivery event owner mismatch");
    expect(migration).toContain("notification delivery subscription owner mismatch");
  });

  it("adds a sending claim state without breaking subscription deletion", () => {
    expect(migration).toContain("'sending'");
    expect(migration).not.toContain("notification_delivery_channel_target");
  });

  it("does not grant new service-role functions", () => {
    expect(migration).not.toContain("grant execute");
    expect(migration).not.toContain("security definer");
  });
});
