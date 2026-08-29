import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260829160000_task_work_sessions.sql");

describe("P3 task work-session contract", () => {
  it("keeps sessions task-owned, owner-scoped, and interval-valid", () => {
    expect(migration).toContain("task_id uuid not null references public.tasks (id) on delete cascade");
    expect(migration).toContain("ends_at > starts_at");
    expect(migration).toContain("work-session task must belong to the same owner");
    expect(migration).toContain("alter table public.task_work_sessions enable row level security");
    expect(migration.match(/\(select auth\.uid\(\)\) = user_id/g)).toHaveLength(5);
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("does not merge sessions into tasks or calendar events", () => {
    const repository = file("src/services/work-sessions/work-session-repository.ts");
    expect(repository).toContain('.from("task_work_sessions")');
    expect(repository).not.toContain('.from("calendar_events")');
    expect(repository).not.toContain('.from("tasks").update');
    expect(repository).toContain("requireAuthenticatedSupabase");
    expect(repository).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
