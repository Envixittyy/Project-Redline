import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Blackboard Course Mappings Migration Security Contract (Phase 7C)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260830110000_blackboard_course_mappings.sql"),
    "utf8",
  );

  it("creates blackboard_course_mappings table with owner and account references", () => {
    expect(sql).toContain("create table if not exists public.blackboard_course_mappings");
    expect(sql).toContain("user_id uuid not null references auth.users(id)");
    expect(sql).toContain("account_id uuid not null references public.integration_accounts(id)");
    expect(sql).toContain("course_id uuid not null references public.courses(id)");
    expect(sql).toContain("source_course_name text not null check (btrim(source_course_name) <> '')");
  });

  it("enforces uniqueness on (user_id, account_id, source_course_name)", () => {
    expect(sql).toContain(
      "create unique index if not exists blackboard_course_mappings_owner_account_source_idx",
    );
    expect(sql).toContain("(user_id, account_id, source_course_name)");
  });

  it("enforces owner relationship trigger for foreign keys", () => {
    expect(sql).toContain("create or replace function public.enforce_blackboard_course_mapping_owner()");
    expect(sql).toContain("create trigger blackboard_course_mappings_owner_enforcement");
    expect(sql).toContain("account must belong to the mapping owner and be a blackboard integration");
    expect(sql).toContain("course must belong to the mapping owner");
  });

  it("enables RLS and defines owner-scoped authenticated policies", () => {
    expect(sql).toContain("alter table public.blackboard_course_mappings enable row level security;");
    expect(sql).toContain("create policy blackboard_course_mappings_select");
    expect(sql).toContain("create policy blackboard_course_mappings_insert");
    expect(sql).toContain("create policy blackboard_course_mappings_update");
    expect(sql).toContain("create policy blackboard_course_mappings_delete");
    expect(sql).toContain("((select auth.uid()) = user_id)");
  });

  it("provides security-invoker RPCs for upsert and bulk assignment", () => {
    expect(sql).toContain("create or replace function public.upsert_blackboard_course_mapping");
    expect(sql).toContain("create or replace function public.bulk_assign_blackboard_records");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("grant execute on function public.upsert_blackboard_course_mapping");
    expect(sql).toContain("grant execute on function public.bulk_assign_blackboard_records");
    expect(sql).toContain("revoke all on function public.upsert_blackboard_course_mapping");
    expect(sql).toContain("revoke all on function public.bulk_assign_blackboard_records");
  });
});
