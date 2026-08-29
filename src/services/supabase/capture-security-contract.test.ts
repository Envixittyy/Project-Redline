import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260829120000_capture_inbox_operations.sql");

describe("P2 capture security and reversibility contract", () => {
  it("owner-scopes every capture and operation table", () => {
    for (const table of [
      "captures",
      "capture_interpretations",
      "capture_proposals",
      "operation_batches",
      "operation_steps",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("keeps raw evidence immutable and guards every cross-table owner relationship", () => {
    expect(migration).toContain("raw capture evidence is immutable");
    expect(migration).toMatch(/if tg_table_name = 'captures' then[\s\S]*new\.interpretation_id/);
    expect(migration).toMatch(/elsif tg_table_name = 'capture_interpretations' then[\s\S]*new\.capture_id/);
    expect(migration).toMatch(/elsif tg_table_name = 'capture_proposals' then[\s\S]*new\.interpretation_id/);
    expect(migration).toMatch(/elsif tg_table_name = 'operation_batches' then[\s\S]*new\.capture_id/);
    expect(migration).toMatch(/elsif tg_table_name = 'operation_steps' then[\s\S]*new\.batch_id/);
  });

  it("commits the task and server-owned inverse through one authenticated RPC", () => {
    expect(migration).toContain("create function public.commit_capture_task");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("insert into public.tasks");
    expect(migration).toContain("jsonb_build_object('action', 'delete_task'");
    expect(migration).toContain("interval '10 minutes'");
    expect(migration).toContain("grant execute on function public.commit_capture_task");
    expect(migration).not.toContain("service_role");
  });

  it("makes undo bounded and protects tasks changed after commit", () => {
    expect(migration).toContain("undo_expires_at < now()");
    expect(migration).toContain("target_task_updated_at > batch_row.committed_at");
    expect(migration).toContain("child.parent_task_id = target_task_id");
    expect(migration).toContain("if capture_row.stage = 'undone' then");
  });

  it("keeps the normal repository on the authenticated request client", () => {
    const repository = file("src/services/captures/capture-repository.ts");
    expect(repository).toContain("requireAuthenticatedSupabase");
    expect(repository).toContain("user_id: userId");
    expect(repository).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(repository).not.toContain("supabase/admin");
  });
});
