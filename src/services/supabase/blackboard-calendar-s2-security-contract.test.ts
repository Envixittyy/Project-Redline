import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260910100000_blackboard_calendar_s2.sql"),
  "utf8",
).toLowerCase();

describe("Blackboard calendar S2 migration contract", () => {
  it("keeps explicit modes off by default and records complete snapshots", () => {
    expect(migration).toContain("blackboard_sync_mode text not null default 'off'");
    expect(migration).toContain("'off','observe','apply'");
    expect(migration).toContain("snapshot_complete boolean not null default false");
  });

  it("links observations to School items without a global uniqueness constraint", () => {
    expect(migration).toContain("school_item_id uuid references public.school_items(id) on delete restrict");
    expect(migration).not.toMatch(/unique\s*\([^)]*school_item_id/);
    expect(migration).toContain("school item must belong to the external record owner/course");
  });

  it("uses the exact S1 owner lock and keeps apply authority service-only", () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('school-email:'||p_user_id::text,0))");
    expect(migration).toContain("auth.role() is distinct from 'service_role'");
    expect(migration).toContain("blackboard_s2_sync_mode_activation");
    expect(migration).toContain("blackboard apply mode requires an operator service role");
    expect(migration).toContain("revoke all on function public.reconcile_blackboard_calendar_snapshot");
    expect(migration).toContain("grant execute on function public.reconcile_blackboard_calendar_snapshot(uuid,uuid,uuid,jsonb) to service_role");
  });

  it("never treats calendar absence as deletion and preserves first-seen email deadlines", () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.(school_items|tasks)/);
    expect(migration).toContain("calendar_absence_is_not_deletion");
    expect(migration).toContain("first_calendar_observation_preserved_email_deadline");
  });
});
