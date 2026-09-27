import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { normalizePostmarkEmail } from "@/services/integrations/email/postmark";
import { normalizeResendEmail } from "@/services/integrations/email/resend";
import { parseBlackboardEmail } from "@/services/integrations/blackboard/email-parser";
import {
  assignmentEmail,
  deadlineEmail,
  emailPolicy,
  forwardedEmail,
  mapuaPolicy,
  newContentEmail,
  newGradeAndFeedbackEmail,
  reminderEmail,
  submissionReceivedEmail,
} from "@/services/integrations/blackboard/fixtures/email-fixtures";
import {
  resendActionableAnnouncementEmail,
  resendActionableMaterialEmail,
  resendAnnouncementEmail,
  resendAssignmentEmail,
  resendCourseOpenedEmail,
  resendDeadlineChangedEmail,
  resendExamEmail,
  resendForwardedEmail,
  resendMalformedEmail,
  resendMaterialEmail,
  resendMultiHeaderDkimEmail,
  resendQuizEmail,
  resendReminderEmail,
  resendUnknownNotificationEmail,
  resendUnmatchedCourseEmail,
} from "@/services/integrations/blackboard/fixtures/resend-fixtures";
import type { SchoolIngestionResult } from "@/types/school-item";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let course: string;
async function ingest(payload = assignmentEmail(), policy = emailPolicy): Promise<SchoolIngestionResult> {
  const event = parseBlackboardEmail(normalizePostmarkEmail(payload, "2026-09-08T02:01:00Z"), policy);
  return (await db.query<{ result: SchoolIngestionResult }>("select public.ingest_school_email($1,$2::jsonb) result", [owner, JSON.stringify(event)])).rows[0].result;
}
async function ingestResend(payload = resendAssignmentEmail(), policy = emailPolicy): Promise<SchoolIngestionResult> {
  const event = parseBlackboardEmail(normalizeResendEmail(payload), policy);
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
    await db.exec("reset role; delete from school_email_events; delete from school_items; delete from school_course_mappings; delete from tasks; delete from courses; delete from course_materials; delete from external_records; delete from integration_accounts;");
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
  it("does not auto-promote a title-only identity when a later email supplies a stable ID", async () => {
    const first = await ingest(assignmentEmail({ TextBody: "Course: CS101\nTitle: Assignment 1" }));
    const later = await ingest(assignmentEmail({ MessageID: "later-with-id" }));
    expect(later).toMatchObject({ status: "unresolved_item", itemId: null, taskId: null });
    expect(first.itemId).toBeTruthy();
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ due_date: null, task_due: null });
  });
  it("does not merge a same-title no-URL notification into an existing strong item", async () => {
    const first = await ingest();
    const ambiguous = await ingest(assignmentEmail({
      MessageID: "same-title-without-id",
      TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: 2026-10-01",
    }));
    expect(ambiguous).toMatchObject({ status: "unresolved_item", itemId: null, taskId: null });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ id: first.itemId, due_date: "2026-09-15" });
    expect((await db.query("select id from tasks")).rows).toHaveLength(1);
  });
  it("deduplicates changed delivery IDs using the original message ID", async () => {
    const payload = assignmentEmail({ Headers: [...assignmentEmail().Headers, { Name: "Message-ID", Value: "<original@learn.example.edu>" }] });
    const first = await ingest(payload);
    expect(await ingest({ ...payload, MessageID: "provider-retry-new-id" })).toMatchObject({ status: "duplicate", itemId: first.itemId, taskId: first.taskId });
    expect(await rows()).toHaveLength(1);
  });
  it("deduplicates cross-provider deliveries between Postmark and Resend using original message ID", async () => {
    const rfcId = "<cross-provider-1@learn.example.edu>";
    const postmarkPayload = assignmentEmail({
      MessageID: "postmark-deliv-1",
      Headers: [...assignmentEmail().Headers, { Name: "Message-ID", Value: rfcId }],
    });
    const postmarkResult = await ingest(postmarkPayload);
    expect(postmarkResult.status).toBe("processed");

    const resendPayload = {
      id: "resend-deliv-2",
      from: "notifications@learn.example.edu",
      to: ["school@inbound.example.com"],
      subject: "New assignment: Assignment 1",
      created_at: "2026-09-08T02:00:00.000Z",
      text: assignmentEmail().TextBody,
      message_id: rfcId,
      headers: {
        "x-spam-status": "No",
        "x-spam-tests": "DKIM_VALID_AU",
        "message-id": rfcId,
      },
    };
    const resendEvent = parseBlackboardEmail(normalizeResendEmail(resendPayload), emailPolicy);
    const resendResult = (await db.query<{ result: SchoolIngestionResult }>(
      "select public.ingest_school_email($1,$2::jsonb) result",
      [owner, JSON.stringify(resendEvent)]
    )).rows[0].result;

    expect(resendResult).toMatchObject({ status: "duplicate", itemId: postmarkResult.itemId, taskId: postmarkResult.taskId });
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

  describe("Base course-code matching and resolution priority", () => {
    it("resolves RZL110_A4_1Q2627 to course code RZL110", async () => {
      const rzlCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'RZL110','ANG BUHAY AT MGA AKDA NI RIZAL') returning id",
        [owner],
      )).rows[0].id;

      const result = await ingest(assignmentEmail({
        MessageID: "rzl-1",
        TextBody: "Course: RZL110_A4_1Q2627\nItem Type: Assignment\nTitle: Rizal Essay\nDue Date: 2026-10-15",
      }));

      expect(result.status).toBe("processed");
      expect(result.taskId).toBeTruthy();
      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0].course_id).toBe(rzlCourse);
      expect(currentRows[0].title).toBe("Rizal Essay");
    });

    it("resolves MATH177_E06_1Q2627 to MATH177", async () => {
      const mathCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'MATH177','CALCULUS 2') returning id",
        [owner],
      )).rows[0].id;

      const result = await ingest(assignmentEmail({
        MessageID: "math-1",
        TextBody: "Course: MATH177_E06_1Q2627\nItem Type: Assignment\nTitle: Problem Set 1\nDue Date: 2026-10-10",
      }));

      expect(result.status).toBe("processed");
      const currentRows = await rows();
      expect(currentRows[0].course_id).toBe(mathCourse);
    });

    it("resolves GED107_C2_1Q2627 to GED107", async () => {
      const gedCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'GED107','ETHICS') returning id",
        [owner],
      )).rows[0].id;

      const result = await ingest(assignmentEmail({
        MessageID: "ged-1",
        TextBody: "Course: GED107_C2_1Q2627\nItem Type: Assignment\nTitle: Case Analysis\nDue Date: 2026-10-20",
      }));

      expect(result.status).toBe("processed");
      const currentRows = await rows();
      expect(currentRows[0].course_id).toBe(gedCourse);
    });

    it("matching is case-insensitive after normalization", async () => {
      const rzlCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'RZL110','ANG BUHAY AT MGA AKDA NI RIZAL') returning id",
        [owner],
      )).rows[0].id;

      const result = await ingest(assignmentEmail({
        MessageID: "case-insens-1",
        TextBody: "Course: rzl110_a4_1q2627\nItem Type: Assignment\nTitle: Rizal Case Study\nDue Date: 2026-10-15",
      }));

      expect(result.status).toBe("processed");
      const currentRows = await rows();
      expect(currentRows[0].course_id).toBe(rzlCourse);
    });

    it("no partial-prefix matching: RZL11 must not match RZL110", async () => {
      await db.query(
        "insert into courses(user_id,code,name) values($1,'RZL110','ANG BUHAY AT MGA AKDA NI RIZAL')",
        [owner],
      );

      const result = await ingest(assignmentEmail({
        MessageID: "partial-prefix-1",
        TextBody: "Course: RZL11_A4_1Q2627\nItem Type: Assignment\nTitle: Rizal Paper\nDue Date: 2026-10-15",
      }));

      expect(result.status).toBe("unresolved_course");
      expect(result.itemId).toBeNull();
      expect(result.taskId).toBeNull();
      expect(await rows()).toHaveLength(0);
    });

    it("ambiguous duplicate course codes fail closed to unresolved_course", async () => {
      // Two active courses that normalize to the same code rzl110 (allowed by case-sensitive unique constraint)
      await db.query("insert into courses(user_id,code,name) values($1,'RZL110','Rizal Section A')", [owner]);
      await db.query("insert into courses(user_id,code,name) values($1,'rzl110','Rizal Section B')", [owner]);

      const result = await ingest(assignmentEmail({
        MessageID: "ambiguous-dupe-1",
        TextBody: "Course: RZL110_A4_1Q2627\nItem Type: Assignment\nTitle: Midterm Essay\nDue Date: 2026-10-15",
      }));

      expect(result.status).toBe("unresolved_course");
      expect(result.itemId).toBeNull();
      expect(result.taskId).toBeNull();
      expect(await rows()).toHaveLength(0);
    });

    it("successful match persists external mappings and subsequent email resolves from saved mapping", async () => {
      const rzlCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'RZL110','ANG BUHAY AT MGA AKDA NI RIZAL') returning id",
        [owner],
      )).rows[0].id;

      // First email with header RZL110_A4_1Q2627 and Blackboard course_id=_165958_1
      const first = await ingest(assignmentEmail({
        MessageID: "first-delivery-1",
        TextBody: "Course: RZL110_A4_1Q2627\nItem Type: Assignment\nTitle: Chapter 1 Essay\nDue Date: 2026-10-15\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_165958_1&content_id=_901_1",
      }));

      expect(first.status).toBe("processed");

      // Verify external mappings persisted
      const mappings = (await db.query<{ source_course_key: string; course_id: string }>(
        "select source_course_key, course_id from school_course_mappings where user_id=$1 order by source_course_key",
        [owner],
      )).rows;

      const mappedKeys = mappings.map((m) => m.source_course_key);
      expect(mappedKeys).toContain("RZL110_A4_1Q2627");
      expect(mappedKeys).toContain("_165958_1");
      expect(mappedKeys).toContain("learn.example.edu:_165958_1");
      for (const m of mappings) {
        expect(m.course_id).toBe(rzlCourse);
      }

      // Now change the course code in Redline to something else (e.g. 'RZL110-OLD')
      // to prove the subsequent email resolves via the persisted mapping, not inference!
      await db.query("update courses set code='RZL110-RENAMED' where id=$1", [rzlCourse]);

      // Subsequent email from the same Blackboard course resolves directly via saved mapping
      const subsequent = await ingest(assignmentEmail({
        MessageID: "second-delivery-2",
        TextBody: "Course: RZL110_A4_1Q2627\nItem Type: Assignment\nTitle: Chapter 2 Essay\nDue Date: 2026-10-22",
      }));

      expect(subsequent.status).toBe("processed");
      const currentRows = await rows();
      expect(currentRows).toHaveLength(2);
      expect(currentRows[1].course_id).toBe(rzlCourse);
      expect(currentRows[1].title).toBe("Chapter 2 Essay");
    });

    it("existing exact code and name matching still works", async () => {
      // CS101 was created in beforeEach with name 'Computer Science'
      // 1. Exact code match: 'CS101'
      const byCode = await ingest(assignmentEmail({
        MessageID: "exact-code-1",
        TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Lab 1\nDue Date: 2026-09-20",
      }));
      expect(byCode.status).toBe("processed");
      expect((await rows())[0].course_id).toBe(course);

      // 2. Exact name match: 'Computer Science'
      const byName = await ingest(assignmentEmail({
        MessageID: "exact-name-1",
        TextBody: "Course: Computer Science\nItem Type: Assignment\nTitle: Lab 2\nDue Date: 2026-09-25",
      }));
      expect(byName.status).toBe("processed");
      expect((await rows())[1].course_id).toBe(course);
    });
  });

  describe("Mapúa Production Blackboard Templates Ingestion", () => {
    it("Template A: marks existing linked task as submitted, preserves due date, does not create new task, survives replay", async () => {
      const gedCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'GED107','ETHICS') returning id",
        [owner],
      )).rows[0].id;

      // First, create the quiz item and task
      const quizCreateResult = await ingest(assignmentEmail({
        MessageID: "quiz-created-1",
        Subject: "New quiz: Synthesis Quiz 2",
        TextBody: "Course: GED107_C2_1Q2627\nItem Type: Quiz\nTitle: Synthesis Quiz 2\nDue Date: 2026-10-01\nhttps://mapua.blackboard.com/item?courseId=_165894_1&contentId=_6827441_1",
      }), mapuaPolicy);

      expect(quizCreateResult.status).toBe("processed");
      expect(quizCreateResult.taskId).toBeTruthy();

      const initialTask = (await db.query<{ status: string; due_date: string }>(
        "select status, due_date::text from tasks where id=$1",
        [quizCreateResult.taskId],
      )).rows[0];
      expect(initialTask.status).toBe("inbox");
      expect(initialTask.due_date).toBe("2026-10-01");

      // Now receive submission confirmation
      const submissionResult = await ingest(submissionReceivedEmail(), mapuaPolicy);
      expect(submissionResult.status).toBe("processed");
      expect(submissionResult.itemId).toBe(quizCreateResult.itemId);
      expect(submissionResult.taskId).toBe(quizCreateResult.taskId);
      expect((await rows())[0].course_id).toBe(gedCourse);

      // Verify task status changed to 'submitted'
      const updatedTask = (await db.query<{ status: string; due_date: string }>(
        "select status, due_date::text from tasks where id=$1",
        [quizCreateResult.taskId],
      )).rows[0];
      expect(updatedTask.status).toBe("submitted");
      // Due date remains unchanged
      expect(updatedTask.due_date).toBe("2026-10-01");

      // Total tasks in db is still 1 (no new task created)
      expect((await db.query("select id from tasks")).rows).toHaveLength(1);

      // Replay of same email is duplicate
      const replay = await ingest(submissionReceivedEmail(), mapuaPolicy);
      expect(replay.status).toBe("duplicate");
      expect(replay.itemId).toBe(quizCreateResult.itemId);
      expect(replay.taskId).toBe(quizCreateResult.taskId);
    });

    it("Template A: missing existing item yields unresolved_item without creating a task", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'GED107','ETHICS')", [owner]);

      const result = await ingest(submissionReceivedEmail(), mapuaPolicy);
      expect(result.status).toBe("unresolved_item");
      expect(result.itemId).toBeNull();
      expect(result.taskId).toBeNull();
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);
      expect((await rows())).toHaveLength(0);
    });

    it("Template A: deleted/missing task yields unresolved_task and never recreates task", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'GED107','ETHICS')", [owner]);

      const quizCreate = await ingest(assignmentEmail({
        MessageID: "quiz-created-del",
        Subject: "New quiz: Synthesis Quiz 2",
        TextBody: "Course: GED107_C2_1Q2627\nItem Type: Quiz\nTitle: Synthesis Quiz 2\nDue Date: 2026-10-01\nhttps://mapua.blackboard.com/item?courseId=_165894_1&contentId=_6827441_1",
      }), mapuaPolicy);

      // Delete the linked task
      await db.query("delete from tasks where id=$1", [quizCreate.taskId]);
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);

      // Ingest submission confirmation
      const submissionResult = await ingest(submissionReceivedEmail(), mapuaPolicy);
      expect(submissionResult.status).toBe("unresolved_task");
      // Never recreated user-deleted task
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);
    });

    it("Template B: creates material school item, creates no Task, and replay does not duplicate", async () => {
      const rzlCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'RZL110','ANG BUHAY AT MGA AKDA NI RIZAL') returning id",
        [owner],
      )).rows[0].id;

      const result = await ingest(newContentEmail(), mapuaPolicy);
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeNull();

      // Verify school_items
      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0].course_id).toBe(rzlCourse);
      expect(currentRows[0].item_type).toBe("material");
      expect(currentRows[0].title).toBe("Ikapitong Linggo - Si Rizal at Ang Noli Me Tangere.pdf");
      expect(currentRows[0].task_id).toBeNull();
      expect(currentRows[0].source_url).toContain("mapua.blackboard.com");

      // Verify no task was created
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);

      // Subsequent message with same contentId does not duplicate the material
      const secondDelivery = await ingest(newContentEmail({ MessageID: "mapua-content-2" }), mapuaPolicy);
      expect(secondDelivery.status).toBe("processed");
      expect(secondDelivery.itemId).toBe(result.itemId);
      expect(await rows()).toHaveLength(1);
    });

    it("Template C: associates grade_updated event with existing item, leaves task status/due unchanged, does not invent score", async () => {
      const mathCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'MATH177','CALCULUS 2') returning id",
        [owner],
      )).rows[0].id;

      // Create initial assessment item
      const initial = await ingest(assignmentEmail({
        MessageID: "math-assessment-1",
        Subject: "New assignment: Series and Integration",
        TextBody: "Course: MATH177_E06_1Q2627\nItem Type: Assignment\nTitle: Calculus through Data & Modelling: Series and Integration\nDue Date: 2026-10-10\nhttps://mapua.blackboard.com/item?courseId=_164519_1&contentId=_6996549_1",
      }), mapuaPolicy);

      expect(initial.status).toBe("processed");
      expect(initial.taskId).toBeTruthy();

      // Receive grade updated notification
      const gradeResult = await ingest(newGradeAndFeedbackEmail(), mapuaPolicy);
      expect(gradeResult.status).toBe("processed");
      expect(gradeResult.itemId).toBe(initial.itemId);

      // Verify task status and due date remain unchanged
      const task = (await db.query<{ status: string; due_date: string }>(
        "select status, due_date::text from tasks where id=$1",
        [initial.taskId],
      )).rows[0];
      expect(task.status).toBe("inbox");
      expect(task.due_date).toBe("2026-10-10");

      // Verify no score is invented and no new tasks created
      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0].course_id).toBe(mathCourse);
      expect((await db.query("select id from tasks")).rows).toHaveLength(1);

      // Event is linked to the item
      const eventRow = (await db.query<{ item_id: string; status: string }>(
        "select item_id, status from school_email_events where id=$1",
        [gradeResult.eventId],
      )).rows[0];
      expect(eventRow.item_id).toBe(initial.itemId);
      expect(eventRow.status).toBe("processed");
    });

    it("Template C: missing existing item yields unresolved_item without creating a task", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'MATH177','CALCULUS 2')", [owner]);

      const result = await ingest(newGradeAndFeedbackEmail(), mapuaPolicy);
      expect(result.status).toBe("unresolved_item");
      expect(result.itemId).toBeNull();
      expect(result.taskId).toBeNull();
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);
    });
  });

  describe("Resend inbound end-to-end integration", () => {
    it("Resend assignment: creates item and linked Task with matching due date and source URL", async () => {
      const result = await ingestResend(resendAssignmentEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeTruthy();

      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0]).toMatchObject({
        course_id: course,
        title: "Assignment 1",
        item_type: "assignment",
        due_date: "2026-09-15",
        task_due: "2026-09-15",
      });
      expect(currentRows[0].source_url).toContain("content_id=_201_1");

      const task = (await db.query<{ status: string; priority: string }>(
        "select status, priority from tasks where id=$1",
        [result.taskId],
      )).rows[0];
      expect(task.status).toBe("inbox");
      expect(task.priority).toBe("none");

      // Calendar events remain untouched (separation of concerns)
      expect((await db.query("select id from calendar_events")).rows).toHaveLength(0);
    });

    it("Resend quiz and exam: each creates item and linked Task with accurate item_type", async () => {
      const quizResult = await ingestResend(resendQuizEmail());
      expect(quizResult.status).toBe("processed");
      expect(quizResult.itemId).toBeTruthy();
      expect(quizResult.taskId).toBeTruthy();

      const examResult = await ingestResend(resendExamEmail());
      expect(examResult.status).toBe("processed");
      expect(examResult.itemId).toBeTruthy();
      expect(examResult.taskId).toBeTruthy();

      const currentRows = await rows();
      expect(currentRows).toHaveLength(2);
      expect(currentRows.map((r) => r.item_type)).toEqual(["quiz", "exam"]);
      expect(currentRows.every((r) => r.task_id !== null)).toBe(true);
    });

    it("Resend material without deadline: creates item only, no Task created", async () => {
      const result = await ingestResend(resendMaterialEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeNull();

      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0]).toMatchObject({
        item_type: "material",
        title: "Lecture Slides Week 2",
        task_id: null,
      });
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);
    });

    it("Resend actionable material with explicit deadline: creates item AND linked Task", async () => {
      const result = await ingestResend(resendActionableMaterialEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeTruthy();

      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0]).toMatchObject({
        item_type: "material",
        title: "Chapter 3 Case Study",
        due_date: "2026-09-24",
        task_due: "2026-09-24",
      });
      expect(currentRows[0].task_id).toBe(result.taskId);
    });

    it("Resend informational announcement: creates item only, no Task created", async () => {
      const result = await ingestResend(resendAnnouncementEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeNull();

      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0]).toMatchObject({
        item_type: "announcement",
        title: "Welcome to CS101",
        task_id: null,
      });
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);
    });

    it("Resend actionable announcement with explicit deadline: creates item AND linked Task", async () => {
      const result = await ingestResend(resendActionableAnnouncementEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeTruthy();

      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0]).toMatchObject({
        item_type: "announcement",
        title: "Submit Team Formation Form",
        due_date: "2026-09-26",
        task_due: "2026-09-26",
      });
    });

    it("Resend course opened: creates activity school item without creating task", async () => {
      const result = await ingestResend(resendCourseOpenedEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeNull();
      expect((await rows())[0]).toMatchObject({
        item_type: "course_opened",
        task_id: null,
      });
    });

    it("Resend duplicate suppression: replaying the same webhook returns duplicate without creating items or tasks", async () => {
      const first = await ingestResend(resendAssignmentEmail());
      expect(first.status).toBe("processed");

      const duplicate = await ingestResend(resendAssignmentEmail());
      expect(duplicate.status).toBe("duplicate");
      expect(duplicate.itemId).toBe(first.itemId);
      expect(duplicate.taskId).toBe(first.taskId);

      expect(await rows()).toHaveLength(1);
      expect((await db.query("select id from tasks")).rows).toHaveLength(1);
    });

    it("Resend deadline update: converges on existing item, handles reminders, and synchronizes task deadline", async () => {
      const initial = await ingestResend(resendAssignmentEmail());
      expect(initial.status).toBe("processed");

      // Reminder on Sept 10 reinforces existing item
      const reminder = await ingestResend(resendReminderEmail());
      expect(reminder.status).toBe("processed");
      expect(reminder.itemId).toBe(initial.itemId);

      // Now date changes to Sept 20 on Sept 11
      const changed = await ingestResend(resendDeadlineChangedEmail());
      expect(changed.status).toBe("processed");
      expect(changed.itemId).toBe(initial.itemId);
      expect(changed.taskId).toBe(initial.taskId);

      const currentRows = await rows();
      expect(currentRows).toHaveLength(1);
      expect(currentRows[0]).toMatchObject({
        due_date: "2026-09-20",
        task_due: "2026-09-20",
      });

      // Out-of-order older reminder (e.g. Sept 9 retry) is marked stale and does not roll back deadline
      const staleReminder = await ingestResend(resendReminderEmail({
        id: "resend-stale-rem-1",
        message_id: "<msg-stale-rem@learn.example.edu>",
        created_at: "2026-09-09T02:00:00.000Z",
        headers: {
          "message-id": "<msg-stale-rem@learn.example.edu>",
          date: "Wed, 9 Sep 2026 10:00:00 +0800",
          "authentication-results": "mx.resend.com; dkim=pass",
        },
      }));
      expect(staleReminder.status).toBe("stale");

      const afterStaleRows = await rows();
      expect(afterStaleRows[0].due_date).toBe("2026-09-20");
    });

    it("Resend multi-header DKIM: parses Outlook + Resend hops cleanly and processes", async () => {
      const result = await ingestResend(resendMultiHeaderDkimEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeTruthy();
    });

    it("Resend forwarded email: extracts forwarded Blackboard notification and creates item + task", async () => {
      const result = await ingestResend(resendForwardedEmail());
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeTruthy();
      expect((await rows())[0]).toMatchObject({
        title: "Assignment 1",
        item_type: "assignment",
        due_date: "2026-09-15",
      });
    });

    it("Resend malformed and unknown types: recorded safely without tasks", async () => {
      const malformed = await ingestResend(resendMalformedEmail());
      expect(malformed.status).toBe("malformed");
      expect(malformed.itemId).toBeNull();

      const unknown = await ingestResend(resendUnknownNotificationEmail());
      expect(unknown.status).toBe("unknown_type");
      expect(unknown.itemId).toBeNull();

      expect(await rows()).toHaveLength(0);
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);
    });

    it("Resend course resolution and review recovery: reprocesses when course is mapped", async () => {
      const initial = await ingestResend(resendUnmatchedCourseEmail());
      expect(initial.status).toBe("unresolved_course");
      expect(initial.itemId).toBeNull();
      expect(initial.taskId).toBeNull();

      // User creates the missing course
      await db.query(
        "insert into courses(user_id,code,name) values($1,'UNKNOWN999','Advanced Topics')",
        [owner],
      );

      // Webhook replay or manual reprocessing re-evaluates the event
      const reprocessed = await ingestResend(resendUnmatchedCourseEmail());
      expect(reprocessed.status).toBe("processed");
      expect(reprocessed.itemId).toBeTruthy();
      expect(reprocessed.taskId).toBeTruthy();
      expect((await rows())[0].title).toBe("Unmatched Course Task");
    });
  });

  describe("Blackboard Calendar S2 and Email Reconciliation & Enhanced Matching", () => {
    it("Calendar S2 imports MATH Quiz 3 due Oct 4 -> email arrives 'Quiz 3 available' -> ONE Redline Quiz 3 (no duplicate, same task)", async () => {
      const mathCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'MATH101','Mathematics') returning id",
        [owner],
      )).rows[0].id;

      // Existing task created from Calendar S2
      const task = (await db.query<{ id: string }>(
        "insert into tasks(user_id,title,status,priority,due_date,course_id) values($1,'MATH Quiz 3','inbox','none','2026-10-04',$2) returning id",
        [owner, mathCourse],
      )).rows[0].id;

      // Existing school item from Calendar S2
      const s2Item = (await db.query<{ id: string }>(
        "insert into school_items(user_id,course_id,item_type,title,title_key,source_key,due_date,task_id,task_created) values($1,$2,'quiz','MATH Quiz 3','math quiz 3','blackboard-cal-math-quiz-3','2026-10-04',$3,true) returning id",
        [owner, mathCourse, task],
      )).rows[0].id;

      // Email notification arrives: "New quiz: Quiz 3 available"
      const email = assignmentEmail({
        MessageID: "email-quiz-3-avail",
        Subject: "[MATH101] New quiz: Quiz 3 available",
        TextBody: "Course: MATH101\nItem Type: Quiz\nTitle: Quiz 3\nDue Date: October 4, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/webapps/assessment/take?course_id=_101_1&assessment_id=_401_1",
      });

      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect(res.itemId).toBe(s2Item);
      expect(res.taskId).toBe(task);

      // Verify no duplicates were created
      const allTasks = (await db.query<{ id: string; title: string; due_date: string }>(
        "select id, title, due_date::text from tasks where course_id=$1",
        [mathCourse],
      )).rows;
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0].id).toBe(task);

      const allItems = (await db.query<{ id: string; title: string; task_id: string }>(
        "select id, title, task_id from school_items where course_id=$1",
        [mathCourse],
      )).rows;
      expect(allItems).toHaveLength(1);
      expect(allItems[0].id).toBe(s2Item);
      expect(allItems[0].task_id).toBe(task);
    });

    it("Calendar S2 imports MATH Quiz 3 due Oct 4 -> email arrives 'Quiz 3 deadline moved to Oct 6' -> ONE Redline Quiz 3 with updated deadline", async () => {
      const mathCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'MATH101','Mathematics') returning id",
        [owner],
      )).rows[0].id;

      const task = (await db.query<{ id: string }>(
        "insert into tasks(user_id,title,status,priority,due_date,course_id) values($1,'MATH Quiz 3','inbox','none','2026-10-04',$2) returning id",
        [owner, mathCourse],
      )).rows[0].id;

      const s2Item = (await db.query<{ id: string }>(
        "insert into school_items(user_id,course_id,item_type,title,title_key,source_key,due_date,task_id,task_created) values($1,$2,'quiz','MATH Quiz 3','math quiz 3','blackboard-cal-math-quiz-3','2026-10-04',$3,true) returning id",
        [owner, mathCourse, task],
      )).rows[0].id;

      const email = assignmentEmail({
        MessageID: "email-quiz-3-deadline-chg",
        Subject: "Due date moved: Quiz 3",
        TextBody: "Course: MATH101\nItem Type: Quiz\nTitle: Quiz 3\nNew Due Date: October 6, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/webapps/assessment/take?course_id=_101_1&assessment_id=_401_1",
      });

      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect(res.itemId).toBe(s2Item);
      expect(res.taskId).toBe(task);

      // Verify deadline updated on both tasks and school_items
      const updatedTask = (await db.query<{ due_date: string }>(
        "select due_date::text from tasks where id=$1",
        [task],
      )).rows[0];
      expect(updatedTask.due_date).toBe("2026-10-06");

      const updatedItem = (await db.query<{ due_date: string }>(
        "select due_date::text from school_items where id=$1",
        [s2Item],
      )).rows[0];
      expect(updatedItem.due_date).toBe("2026-10-06");

      expect((await db.query("select id from tasks where course_id=$1", [mathCourse])).rows).toHaveLength(1);
    });

    it("reconciles via external_records link when calendar external record exists", async () => {
      const cpeCourse = (await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'CPE201','Embedded Systems') returning id",
        [owner],
      )).rows[0].id;

      const task = (await db.query<{ id: string }>(
        "insert into tasks(user_id,title,status,priority,due_date,course_id) values($1,'Lab 1: GPIO','inbox','none','2026-10-15',$2) returning id",
        [owner, cpeCourse],
      )).rows[0].id;

      const item = (await db.query<{ id: string }>(
        "insert into school_items(user_id,course_id,item_type,title,title_key,source_key,due_date,task_id,task_created) values($1,$2,'assignment','Lab 1: GPIO','lab 1 gpio','cpe-lab-1-cal','2026-10-15',$3,true) returning id",
        [owner, cpeCourse, task],
      )).rows[0].id;

      // Existing external record from Blackboard calendar snapshot
      const account = (await db.query<{ id: string }>(
        "insert into integration_accounts(user_id,provider,encrypted_credential) values($1,'blackboard','fake-token') returning id",
        [owner],
      )).rows[0].id;

      await db.query(
        "insert into external_records(user_id,account_id,provider,external_uid,task_id,course_id,normalized_title,source_url,content_hash) values($1,$2,'blackboard','blackboard-cal-ext-gpio',$3,$4,'Lab 1: GPIO','https://learn.example.edu/gpio',repeat('a', 64))",
        [owner, account, task, cpeCourse],
      );

      const email = assignmentEmail({
        MessageID: "email-lab1-gpio",
        Subject: "New assignment: Lab 1: GPIO",
        TextBody: "Course: CPE201\nItem Type: Assignment\nTitle: Lab 1: GPIO\nDue Date: October 15, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/gpio",
      });

      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect(res.itemId).toBe(item);
      expect(res.taskId).toBe(task);
      expect((await db.query("select id from tasks where course_id=$1", [cpeCourse])).rows).toHaveLength(1);
    });

    it("course matching: CPE 123 matches CPE123", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'CPE123','Computer Engineering')", [owner]);
      const email = assignmentEmail({
        MessageID: "msg-cpe-space",
        TextBody: "Course: CPE 123\nItem Type: Assignment\nTitle: Activity 1\nDue Date: 2026-10-10\nhttps://learn.example.edu/cpe1",
      });
      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect((await rows())[0].title).toBe("Activity 1");
    });

    it("course matching: CPE123 matches CPE 123", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'CPE 123','Computer Engineering')", [owner]);
      const email = assignmentEmail({
        MessageID: "msg-cpe-nospace",
        TextBody: "Course: CPE123\nItem Type: Assignment\nTitle: Activity 2\nDue Date: 2026-10-10\nhttps://learn.example.edu/cpe2",
      });
      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect((await rows())[0].title).toBe("Activity 2");
    });

    it("course matching: CPE 123 - Computer Engineering matches CPE123", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'CPE123','Computer Engineering')", [owner]);
      const email = assignmentEmail({
        MessageID: "msg-cpe-dash",
        TextBody: "Course: CPE 123 - Computer Engineering\nItem Type: Assignment\nTitle: Activity 3\nDue Date: 2026-10-10\nhttps://learn.example.edu/cpe3",
      });
      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect((await rows())[0].title).toBe("Activity 3");
    });

    it("course matching: Computer Engineering 123 matches course named Computer Engineering", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'CPE-CE','Computer Engineering')", [owner]);
      const email = assignmentEmail({
        MessageID: "msg-cpe-name-number",
        TextBody: "Course: Computer Engineering 123\nItem Type: Assignment\nTitle: Activity 4\nDue Date: 2026-10-10\nhttps://learn.example.edu/cpe4",
      });
      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect((await rows())[0].title).toBe("Activity 4");
    });

    it("course matching: ambiguous course codes fail safely to unresolved_course", async () => {
      await db.query("insert into courses(user_id,code,name) values($1,'CPE123','Computer Engineering A')", [owner]);
      await db.query("insert into courses(user_id,code,name) values($1,'CPE 123','Computer Engineering B')", [owner]);
      const email = assignmentEmail({
        MessageID: "msg-ambiguous-cpe",
        TextBody: "Course: CPE 123\nItem Type: Assignment\nTitle: Activity Ambiguous\nDue Date: 2026-10-10\nhttps://learn.example.edu/cpe-amb",
      });
      const res = await ingest(email);
      expect(res.status).toBe("unresolved_course");
      expect(res.itemId).toBeNull();
      expect(res.taskId).toBeNull();
    });

    it("course material mirroring: creates row in school_items AND course_materials, with NO task", async () => {
      const email = assignmentEmail({
        MessageID: "msg-mat-mirror",
        Subject: "New course material available: Chapter 4 Slides",
        TextBody: "Course: CS101\nItem Type: Material\nTitle: Chapter 4 Slides\nhttps://learn.example.edu/webapps/blackboard/content?course_id=_101_1&content_id=_901_1",
      });
      const res = await ingest(email);
      expect(res.status).toBe("processed");
      expect(res.itemId).toBeTruthy();
      expect(res.taskId).toBeNull();

      // Verify no task was created
      const tasks = (await db.query("select id from tasks")).rows;
      expect(tasks).toHaveLength(0);

      // Verify course_materials table received the mirrored material
      const materials = (await db.query<{ id: string; title: string; type: string; url: string }>(
        "select id, title, type, url from course_materials",
      )).rows;
      expect(materials).toHaveLength(1);
      expect(materials[0]).toMatchObject({
        title: "Chapter 4 Slides",
        type: "document",
      });
      expect(materials[0].url).toContain("content_id=_901_1");
    });

    it("announcement processing: informational creates item only, actionable with deadline creates item and task", async () => {
      // 1. Informational announcement
      const infoEmail = assignmentEmail({
        MessageID: "msg-ann-info",
        Subject: "Announcement: Welcome to Class",
        TextBody: "Course: CS101\nItem Type: Announcement\nTitle: Welcome to Class\nWelcome to CS101, syllabus is posted.\nhttps://learn.example.edu/announcement?course_id=_101_1&announcement_id=_801_1",
      });
      const infoRes = await ingest(infoEmail);
      expect(infoRes.status).toBe("processed");
      expect(infoRes.taskId).toBeNull();
      expect((await db.query("select id from tasks")).rows).toHaveLength(0);

      // 2. Actionable announcement with explicit deadline
      const actEmail = assignmentEmail({
        MessageID: "msg-ann-actionable",
        Subject: "Announcement: Complete Survey by Friday",
        TextBody: "Course: CS101\nItem Type: Announcement\nTitle: Complete Survey by Friday\nDue Date: September 25, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/announcement?course_id=_101_1&announcement_id=_802_1",
      });
      const actRes = await ingest(actEmail);
      expect(actRes.status).toBe("processed");
      expect(actRes.taskId).toBeTruthy();

      const tasks = (await db.query<{ id: string; title: string; due_date: string }>("select id, title, due_date::text from tasks")).rows;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        title: "Complete Survey by Friday",
        due_date: "2026-09-25",
      });
    });
  });
});
