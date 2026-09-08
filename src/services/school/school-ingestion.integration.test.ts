import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { normalizePostmarkEmail } from "@/services/integrations/email/postmark";
import { parseBlackboardEmail } from "@/services/integrations/blackboard/email-parser";
import { assignmentEmail, deadlineEmail, emailPolicy, forwardedEmail, reminderEmail } from "@/services/integrations/blackboard/fixtures/email-fixtures";
import type { SchoolIngestionResult } from "@/types/school-item";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let course: string;
async function ingest(payload = assignmentEmail()): Promise<SchoolIngestionResult> {
  const event = parseBlackboardEmail(normalizePostmarkEmail(payload, "2026-09-08T02:01:00Z"), emailPolicy);
  return (await db.query<{ result: SchoolIngestionResult }>("select public.ingest_school_email($1,$2::jsonb) result", [owner, JSON.stringify(event)])).rows[0].result;
}
async function rows() {
  return (await db.query<{ id: string; task_id: string; course_id: string; item_type: string; title: string; due_date: string; due_at: string; task_due: string; source_url: string }>("select i.id,i.task_id,i.course_id,i.item_type,i.title,i.due_date::text,i.due_at::text,t.due_date::text task_due,i.source_url from school_items i left join tasks t on t.id=i.task_id order by i.created_at")).rows;
}
describe("School email through actual PostgreSQL migrations", () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('role',true) $$;
      grant usage on schema auth, public to authenticated, anon, service_role;
      grant execute on all functions in schema auth to authenticated, anon, service_role;
      alter default privileges in schema public grant all on tables to authenticated, service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid,name text,bucket_id text);
    `);
    for (const file of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users values($1),($2)", [owner, foreign]);
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("reset role; delete from school_email_events; delete from school_items; delete from school_course_mappings; delete from tasks; delete from courses;");
    course = (await db.query<{ id: string }>("insert into courses(user_id,code,name) values($1,'CS101','Computer Science') returning id", [owner])).rows[0].id;
    await db.exec("set role service_role");
  });

  it("A/B/C/D: creates exactly one item and Task, survives duplicates/reminders/forwards, then updates both deadlines", async () => {
    const first = await ingest();
    expect(first.status).toBe("processed");
    expect(first.taskId).toBeTruthy();
    expect((await rows())[0]).toMatchObject({ course_id: course, title: "Assignment 1", item_type: "assignment", due_date: "2026-09-15", task_due: "2026-09-15" });
    expect((await rows())[0].source_url).toContain("content_id=_201_1");
    expect((await ingest()).status).toBe("duplicate");
    await ingest(reminderEmail());
    await ingest(forwardedEmail());
    const changed = await ingest(deadlineEmail());
    expect(changed).toMatchObject({ status: "processed", itemId: first.itemId, taskId: first.taskId });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ due_date: "2026-09-18", task_due: "2026-09-18" });
    expect((await db.query("select id from tasks")).rows).toHaveLength(1);
    expect((await db.query("select id from calendar_events")).rows).toHaveLength(0);
  });
  it("E: scopes title and external identity by course", async () => {
    await db.query("insert into courses(user_id,code,name) values($1,'CS102','Systems')", [owner]);
    await ingest();
    await ingest(assignmentEmail({ MessageID: "other-course", TextBody: assignmentEmail().TextBody.replaceAll("CS101", "CS102").replaceAll("_101_1", "_102_1") }));
    expect(await rows()).toHaveLength(2);
    expect(new Set((await rows()).map(r => r.course_id)).size).toBe(2);
  });
  it.each(["Quiz", "Exam"])("F: %s creates an actionable item and Task", async type => {
    await ingest(assignmentEmail({ Subject: `${type}: Week 1`, TextBody: `Course: CS101\nItem Type: ${type}\nTitle: Week 1` }));
    expect((await rows())[0]).toMatchObject({ item_type: type.toLowerCase() });
    expect((await rows())[0].task_id).toBeTruthy();
  });
  it.each(["Material", "Announcement"])("G/H: %s is activity only", async type => {
    await ingest(assignmentEmail({ Subject: `${type}: Week 1`, TextBody: `Course: CS101\nItem Type: ${type}\nTitle: Week 1` }));
    expect((await rows())[0]).toMatchObject({ item_type: type.toLowerCase(), task_id: null });
    expect((await db.query("select id from tasks")).rows).toHaveLength(0);
  });
  it("I/J: malformed, unknown, unrelated, and unmapped messages have durable safe outcomes", async () => {
    expect((await ingest(assignmentEmail({ TextBody: "Title: Assignment 1\nDue Date: maybe" }))).status).toBe("malformed");
    expect((await ingest(assignmentEmail({ MessageID: "unknown", Subject: "Digest", TextBody: "Hello" }))).status).toBe("unknown_type");
    expect((await ingest(assignmentEmail({ MessageID: "unrelated", FromFull: { Email: "other@example.net" } }))).status).toBe("ignored");
    expect((await ingest(assignmentEmail({ MessageID: "unmapped", TextBody: assignmentEmail().TextBody.replace("CS101", "MISSING") }))).status).toBe("unresolved_course");
    expect(await rows()).toHaveLength(0);
    expect((await db.query("select id from school_email_events")).rows).toHaveLength(4);
  });
  it("K: Task failure rolls back item and event; retry commits exactly once", async () => {
    await db.exec("reset role; create function fail_school_test_task() returns trigger language plpgsql as $$ begin raise exception 'simulated task failure'; end $$; create trigger fail_school_test before insert on tasks for each row execute function fail_school_test_task(); set role service_role;");
    await expect(ingest()).rejects.toThrow("simulated task failure");
    expect(await rows()).toHaveLength(0);
    expect((await db.query("select id from school_email_events")).rows).toHaveLength(0);
    await db.exec("reset role; drop trigger fail_school_test on tasks; drop function fail_school_test_task(); set role service_role;");
    await ingest(); await ingest();
    expect(await rows()).toHaveLength(1);
  });
  it("does not invent a target for a change or reminder received first", async () => {
    expect((await ingest(deadlineEmail())).status).toBe("unresolved_item");
    expect((await ingest(reminderEmail())).status).toBe("unresolved_item");
    expect(await rows()).toHaveLength(0);
    await ingest();
    expect((await ingest(deadlineEmail())).status).toBe("processed");
  });
  it("preserves completed Task state and rejects stale changes and task recreation", async () => {
    const first = await ingest();
    await db.query("update tasks set status='completed',completed_at=now() where id=$1", [first.taskId]);
    await ingest(deadlineEmail());
    expect((await db.query<{ status: string }>("select status from tasks")).rows[0].status).toBe("completed");
    expect((await ingest(assignmentEmail({ ...deadlineEmail(), MessageID: "late-old-change", Date: "Wed, 9 Sep 2026 10:00:00 +0800" }))).status).toBe("stale");
    await db.query("delete from tasks where id=$1", [first.taskId]);
    expect((await ingest(assignmentEmail({ ...deadlineEmail(), MessageID: "after-delete", Date: "Fri, 11 Sep 2026 10:00:00 +0800" }))).status).toBe("unresolved_task");
    expect((await db.query("select id from tasks")).rows).toHaveLength(0);
  });
  it("promotes a title-only identity when a later email supplies a stable ID", async () => {
    const first = await ingest(assignmentEmail({ TextBody: "Course: CS101\nTitle: Assignment 1" }));
    const later = await ingest(assignmentEmail({ MessageID: "later-with-id" }));
    expect(later.itemId).toBe(first.itemId);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ due_date: "2026-09-15", task_due: "2026-09-15" });
  });
  it("deduplicates changed delivery IDs using the original message ID", async () => {
    const payload = assignmentEmail({ Headers: [...assignmentEmail().Headers, { Name: "Message-ID", Value: "<original@learn.example.edu>" }] });
    const first = await ingest(payload);
    expect(await ingest({ ...payload, MessageID: "provider-retry-new-id" })).toMatchObject({ status: "duplicate", itemId: first.itemId, taskId: first.taskId });
    expect(await rows()).toHaveLength(1);
  });
  it("preserves item identity when a source URL adds the course parameter later", async () => {
    const first = await ingest(assignmentEmail({ TextBody: assignmentEmail().TextBody.replace("course_id=_101_1&", "") }));
    const later = await ingest(assignmentEmail({ MessageID: "link-enriched" }));
    expect(later.itemId).toBe(first.itemId);
    expect(await rows()).toHaveLength(1);
  });
  it("keeps date-only deadlines date-only on both entities", async () => {
    await ingest(assignmentEmail({ TextBody: "Course: CS101\nTitle: Assignment 1\nDue Date: 2026-09-15" }));
    expect((await rows())[0]).toMatchObject({ due_date: "2026-09-15", task_due: "2026-09-15", due_at: null });
    expect((await db.query<{ due_at: string | null }>("select due_at from tasks")).rows[0].due_at).toBeNull();
  });
  it("distinct strong IDs with identical titles remain distinct; vague change is unresolved", async () => {
    await ingest();
    await ingest(assignmentEmail({ MessageID: "different-id", TextBody: assignmentEmail().TextBody.replace("_201_1", "_202_1") }));
    expect(await rows()).toHaveLength(2);
    expect((await ingest(assignmentEmail({ ...deadlineEmail(), TextBody: "Course: CS101\nTitle: Assignment 1\nNew Due Date: 2026-09-20" }))).status).toBe("unresolved_item");
  });
  it("RLS hides other owners, blocks direct event/Task-link injection and permits ID-only retry after mapping", async () => {
    const pending = await ingest(assignmentEmail({ TextBody: assignmentEmail().TextBody.replace("CS101", "UNKNOWN") }));
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${foreign}';`);
    expect((await db.query("select id from school_email_events")).rows).toHaveLength(0);
    await expect(db.query("select retry_school_email_event($1)", [pending.eventId])).rejects.toThrow();
    await expect(db.query("select ingest_school_email($1,'{}')", [owner])).rejects.toThrow();
    await expect(db.query("insert into school_items(user_id,course_id,item_type,title,title_key) values($1,$2,'assignment','Fake','fake')", [foreign, course])).rejects.toThrow();
    await expect(db.query("insert into school_course_mappings(user_id,course_id,source_course_key) values($1,$2,'fake')", [foreign, course])).rejects.toThrow();
    await db.exec(`set request.jwt.claim.sub='${owner}';`);
    await db.query("insert into school_course_mappings(user_id,course_id,source_course_key) values($1,$2,'learn.example.edu:_101_1')", [owner, course]);
    const retry = (await db.query<{ result: SchoolIngestionResult }>("select retry_school_email_event($1) result", [pending.eventId])).rows[0].result;
    expect(retry.status).toBe("processed");
    expect(await rows()).toHaveLength(1);
  });
});
