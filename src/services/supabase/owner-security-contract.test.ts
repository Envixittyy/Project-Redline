import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function repositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = repositoryFile("supabase/migrations/20260828160000_owner_scoped_rls.sql");

describe("owner-scoped persistence contract", () => {
  it("adds auth-user ownership and indexes to both personal tables", () => {
    expect(migration.match(/add column user_id uuid\s+references auth\.users/g)).toHaveLength(2);
    expect(migration.match(/alter column user_id set default auth\.uid\(\)/g)).toHaveLength(2);
    expect(migration.match(/references auth\.users \(id\) on delete cascade/g)).toHaveLength(2);
    expect(migration).toContain("tasks_user_id_status_due_date_idx");
    expect(migration).toContain("calendar_events_user_id_range_idx");
  });

  it("installs CRUD policies that derive ownership from auth.uid", () => {
    for (const table of ["tasks", "calendar_events"]) {
      for (const operation of ["select", "insert", "update", "delete"]) {
        expect(migration).toContain(`create policy ${table}_${operation}_own`);
      }
    }

    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/with check\s*\(\s*true\s*\)/i);
    expect(migration.match(/\(select auth\.uid\(\)\) = user_id/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps backfill repeat-safe and refuses premature finalization", () => {
    expect(migration.match(/set user_id = target_owner where user_id is null/g)).toHaveLength(2);
    expect(migration).toContain("ownerless rows remain");
    expect(migration).toContain("alter column user_id set not null");
    expect(migration).toContain("grant execute on function public.backfill_personal_data_owner(uuid) to service_role");
    expect(migration).toContain("grant execute on function public.finalize_personal_data_ownership() to service_role");
  });

  it("keeps normal repositories on the request client and service role behind admin", () => {
    const tasks = repositoryFile("src/services/tasks/task-repository.ts");
    const events = repositoryFile("src/services/calendar-events/calendar-event-repository.ts");
    const admin = repositoryFile("src/services/supabase/admin.ts");

    for (const source of [tasks, events]) {
      expect(source).toContain("requireAuthenticatedSupabase");
      expect(source).toContain("user_id: userId");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("supabase/admin");
    }
    expect(admin).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("requires server actions to translate missing or expired authentication safely", () => {
    const taskActions = repositoryFile("src/features/tasks/task-actions.ts");
    const calendarActions = repositoryFile("src/features/calendar/calendar-actions.ts");

    for (const source of [taskActions, calendarActions]) {
      expect(source).toContain("authFailureMessage(error)");
      expect(source).not.toContain("error.detail");
    }
  });
});
