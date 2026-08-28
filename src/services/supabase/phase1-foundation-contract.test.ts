import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const migration=file("supabase/migrations/20260828200000_phase_1_foundation.sql");
const relationshipTriggerFix=file("supabase/migrations/20260829000000_fix_phase1_relationship_owner_trigger.sql");

describe("Phase 1 foundation security contract",()=>{
  it("owner-scopes courses, meetings, notes, and attachment metadata",()=>{
    for(const table of ["courses","course_meetings","notes","attachments"]){
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("default auth.uid() references auth.users (id) on delete cascade");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).toContain("enforce_phase1_relationship_owner");
    expect(migration).toContain("must belong to the same owner");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("keeps attachments private and verifies the owner storage prefix",()=>{
    expect(migration).toContain("'private-attachments', 'private-attachments', false");
    expect(migration).toContain("split_part(storage_path, '/', 1) = user_id::text");
    expect(migration.match(/split_part\(name, '\/', 1\) = \(select auth\.uid\(\)\)::text/g)).toHaveLength(5);
    const collection=file("src/app/api/attachments/route.ts");
    const item=file("src/app/api/attachments/[id]/route.ts");
    expect(collection).toContain("randomUUID()");
    expect(collection).toContain("MAX_SIZE=10*1024*1024");
    expect(collection).toContain("remove([storagePath])");
    expect(item).toContain("createSignedUrl");
    for(const source of [collection,item])expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("guards table-specific trigger fields inside table-specific branches",()=>{
    expect(relationshipTriggerFix).toMatch(/if tg_table_name = 'tasks' then[\s\S]*new\.parent_task_id/);
    expect(relationshipTriggerFix).toMatch(/elsif tg_table_name = 'course_meetings' then[\s\S]*new\.course_id/);
    expect(relationshipTriggerFix).toMatch(/elsif tg_table_name = 'notes' then[\s\S]*new\.task_id/);
    expect(relationshipTriggerFix).toMatch(/elsif tg_table_name = 'attachments' then[\s\S]*new\.note_id/);
    expect(relationshipTriggerFix).not.toContain("tg_table_name = 'tasks' and new.parent_task_id");
    expect(relationshipTriggerFix).not.toContain("tg_table_name = 'course_meetings' and not exists");
  });

  it("uses durable offline identities and truthful queue states",()=>{
    const queue=file("src/lib/offline/queue.ts");
    const replay=file("src/app/api/offline/mutations/route.ts");
    expect(queue).toContain("indexedDB.open");
    expect(queue).toContain('state:"pending"');
    expect(queue).toContain('"failed"|"conflict"');
    expect(replay).toContain("clientOperationId:operationId");
    expect(migration).toContain("tasks_owner_operation_unique");
    expect(migration).toContain("notes_owner_operation_unique");
  });

  it("projects course meetings without creating calendar event rows",()=>{
    const calendar=file("src/features/calendar/calendar-items.ts");
    const courses=file("src/services/courses/course-repository.ts");
    expect(calendar).toContain("courseMeetingToCalendarEntries");
    expect(courses).toContain("course_meetings");
    expect(courses).not.toContain('from("calendar_events").insert');
  });
});
