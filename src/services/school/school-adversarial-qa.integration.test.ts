import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { normalizePostmarkEmail } from "@/services/integrations/email/postmark";
import { parseBlackboardEmail } from "@/services/integrations/blackboard/email-parser";
import {
  announcementEmail,
  assignmentEmail,
  deadlineEmail,
  emailPolicy,
  examEmail,
  forwardedEmail,
  materialEmail,
  missingDueDateEmail,
  missingUrlEmail,
  quizEmail,
  reminderEmail,
  spoofedBlackboardEmail,
  unrelatedSchoolEmail,
} from "@/services/integrations/blackboard/fixtures/email-fixtures";
import type { SchoolIngestionResult } from "@/types/school-item";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";

let db: PGlite;
let courseCS101: string;

async function ingest(payload: Record<string, unknown>): Promise<SchoolIngestionResult> {
  const event = parseBlackboardEmail(
    normalizePostmarkEmail(payload, "2026-09-08T02:01:00Z"),
    emailPolicy,
  );
  const res = await db.query<{ result: SchoolIngestionResult }>(
    "select public.ingest_school_email($1, $2::jsonb) as result",
    [owner, JSON.stringify(event)],
  );
  return res.rows[0].result;
}

async function getItems() {
  return (
    await db.query<{
      id: string;
      course_id: string;
      item_type: string;
      title: string;
      due_date: string | null;
      due_at: string | null;
      source_url: string | null;
      weight: number | null;
      task_id: string | null;
    }>("select id, course_id, item_type, title, due_date::text, due_at::text, source_url, weight::float, task_id from school_items order by created_at")
  ).rows;
}

async function getTasks() {
  return (
    await db.query<{
      id: string;
      course_id: string | null;
      title: string;
      status: string;
      due_date: string | null;
      due_at: string | null;
    }>("select id, course_id, title, status, due_date::text, due_at::text from tasks order by created_at")
  ).rows;
}

describe("Adversarial QA — Phase S1 Core Verification (Scenarios A through S)", () => {
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
    for (const file of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.query("insert into auth.users values($1),($2)", [owner, foreign]);
  }, 60000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec(
      "reset role; delete from school_email_events; delete from school_items; delete from school_course_mappings; delete from tasks; delete from courses;",
    );
    courseCS101 = (
      await db.query<{ id: string }>(
        "insert into courses(user_id, code, name) values($1, 'CS101', 'Computer Science 1') returning id",
        [owner],
      )
    ).rows[0].id;
    await db.exec("set role service_role");
  });

  // Scenario A: Exact duplicate provider message
  it("Scenario A: processes exact duplicate provider message safely with no duplicate items or tasks", async () => {
    const payload = assignmentEmail();
    const first = await ingest(payload);
    expect(first.status).toBe("processed");
    expect(first.taskId).toBeTruthy();

    const second = await ingest(payload);
    expect(second.status).toBe("duplicate");
    expect(second.itemId).toBe(first.itemId);
    expect(second.taskId).toBe(first.taskId);

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(items[0].id).toBe(first.itemId);
    expect(tasks[0].id).toBe(first.taskId);
  });

  // Scenario B: Same logical assignment, different notification (creation then reminder)
  it("Scenario B: creation email followed by reminder notification resolves to the same School item and Task", async () => {
    const creation = await ingest(assignmentEmail());
    expect(creation.status).toBe("processed");

    const reminder = await ingest(reminderEmail());
    expect(reminder.status).toBe("processed");
    expect(reminder.itemId).toBe(creation.itemId);
    expect(reminder.taskId).toBe(creation.taskId);

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(tasks).toHaveLength(1);
  });

  // Scenario C: Deadline change
  it("Scenario C: updates both School item and linked Task deadline without creating duplicates", async () => {
    const original = await ingest(assignmentEmail());
    expect(original.status).toBe("processed");

    const updated = await ingest(deadlineEmail());
    expect(updated.status).toBe("processed");
    expect(updated.itemId).toBe(original.itemId);
    expect(updated.taskId).toBe(original.taskId);

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(items[0].due_date).toBe("2026-09-18");
    expect(tasks[0].due_date).toBe("2026-09-18");
  });

  // Scenario D: Same title in two Courses
  it("Scenario D: identical assignment titles in two different Courses produce separate School items and Tasks", async () => {
    const courseMath201 = (
      await db.query<{ id: string }>(
        "insert into courses(user_id, code, name) values($1, 'MATH201', 'Calculus I') returning id",
        [owner],
      )
    ).rows[0].id;

    // Assignment 1 in CS101
    const resCS = await ingest(
      assignmentEmail({
        MessageID: "cs-assign-1",
        TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: 2026-09-15\nhttps://learn.example.edu/cs101/item1",
      }),
    );
    expect(resCS.status).toBe("processed");

    // Assignment 1 in MATH201
    const resMath = await ingest(
      assignmentEmail({
        MessageID: "math-assign-1",
        TextBody: "Course: MATH201\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: 2026-09-16\nhttps://learn.example.edu/math201/item1",
      }),
    );
    expect(resMath.status).toBe("processed");

    expect(resCS.itemId).not.toBe(resMath.itemId);
    expect(resCS.taskId).not.toBe(resMath.taskId);

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(2);
    expect(tasks).toHaveLength(2);

    const csItem = items.find((i) => i.course_id === courseCS101);
    const mathItem = items.find((i) => i.course_id === courseMath201);
    expect(csItem).toBeDefined();
    expect(mathItem).toBeDefined();
    expect(csItem?.title).toBe("Assignment 1");
    expect(mathItem?.title).toBe("Assignment 1");
  });

  // Scenario E: Similar Course names
  it("Scenario E: matches exact Course code/name among similar Courses, failing safely on ambiguous abbreviations", async () => {
    const cpe101 = (
      await db.query<{ id: string }>(
        "insert into courses(user_id, code, name) values($1, 'CpE 101', 'Computer Engineering 1') returning id",
        [owner],
      )
    ).rows[0].id;

    const cpe102 = (
      await db.query<{ id: string }>(
        "insert into courses(user_id, code, name) values($1, 'CpE 102', 'Computer Engineering 2') returning id",
        [owner],
      )
    ).rows[0].id;

    // Send item for Computer Engineering 2
    const res102 = await ingest(
      assignmentEmail({
        MessageID: "cpe-102-assign",
        TextBody: "Course: Computer Engineering 2\nItem Type: Assignment\nTitle: Lab 1\nDue Date: 2026-09-20\nhttps://learn.example.edu/cpe102/lab1",
      }),
    );
    expect(res102.status).toBe("processed");

    // Send item for Computer Engineering 1
    const res101 = await ingest(
      assignmentEmail({
        MessageID: "cpe-101-assign",
        TextBody: "Course: Computer Engineering 1\nItem Type: Assignment\nTitle: Lab 1\nDue Date: 2026-09-21\nhttps://learn.example.edu/cpe101/lab1",
      }),
    );
    expect(res101.status).toBe("processed");

    const items = await getItems();
    const item102 = items.find((i) => i.course_id === cpe102);
    const item101 = items.find((i) => i.course_id === cpe101);
    expect(item102?.id).toBe(res102.itemId);
    expect(item101?.id).toBe(res101.itemId);
    expect(item102?.course_id).not.toBe(item101?.course_id);

    // Send ambiguous hint that matches neither exactly -> unresolved_course
    const ambiguous = await ingest(
      assignmentEmail({
        MessageID: "cpe-ambig-assign",
        TextBody: "Course: Computer Engineering\nItem Type: Assignment\nTitle: Lab 2\nDue Date: 2026-09-25",
      }),
    );
    expect(ambiguous.status).toBe("unresolved_course");
  });

  // Scenario F: Unknown Course
  it("Scenario F: unknown Course resolves safely to unresolved_course and never misattaches to existing courses", async () => {
    const unknown = await ingest(
      assignmentEmail({
        MessageID: "unknown-course-1",
        TextBody: "Course: ADV499 Quantum Computing\nItem Type: Assignment\nTitle: Quantum Circuit Project\nDue Date: 2026-10-01",
      }),
    );
    expect(unknown.status).toBe("unresolved_course");
    expect(unknown.itemId).toBeNull();
    expect(unknown.taskId).toBeNull();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  // Scenario G: Material
  it("Scenario G: Material ingestion creates a School item but DOES NOT create a Task", async () => {
    const res = await ingest(materialEmail());
    expect(res.status).toBe("processed");
    expect(res.itemId).toBeTruthy();
    expect(res.taskId).toBeNull();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(items[0].item_type).toBe("material");
    expect(items[0].task_id).toBeNull();
    expect(tasks).toHaveLength(0);
  });

  // Scenario H: Informational Announcement
  it("Scenario H: Announcement ingestion creates an informational School item and NO Task", async () => {
    const res = await ingest(announcementEmail());
    expect(res.status).toBe("processed");
    expect(res.itemId).toBeTruthy();
    expect(res.taskId).toBeNull();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(items[0].item_type).toBe("announcement");
    expect(items[0].task_id).toBeNull();
    expect(tasks).toHaveLength(0);
  });

  // Scenario I: Quiz
  it("Scenario I: Quiz creates a distinct quiz item and linked Task with deadline and weight", async () => {
    const res = await ingest(quizEmail());
    expect(res.status).toBe("processed");
    expect(res.itemId).toBeTruthy();
    expect(res.taskId).toBeTruthy();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(items[0].item_type).toBe("quiz");
    expect(items[0].weight).toBe(10);
    expect(items[0].due_date).toBe("2026-09-22");
    expect(items[0].task_id).toBe(tasks[0].id);
    expect(tasks[0].due_date).toBe("2026-09-22");
  });

  // Scenario J: Exam/Test
  it("Scenario J: Exam creates a distinct exam item and linked Task with deadline and weight", async () => {
    const res = await ingest(examEmail());
    expect(res.status).toBe("processed");
    expect(res.itemId).toBeTruthy();
    expect(res.taskId).toBeTruthy();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(items[0].item_type).toBe("exam");
    expect(items[0].weight).toBe(30);
    expect(items[0].due_date).toBe("2026-10-05");
    expect(items[0].task_id).toBe(tasks[0].id);
  });

  // Scenario K: Missing due date
  it("Scenario K: item without due date creates valid School item and Task with null due date, without fabricating midnight", async () => {
    const res = await ingest(missingDueDateEmail());
    expect(res.status).toBe("processed");

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(1);
    expect(items[0].due_date).toBeNull();
    expect(items[0].due_at).toBeNull();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].due_date).toBeNull();
    expect(tasks[0].due_at).toBeNull();
    expect(tasks[0].status).toBe("inbox");
  });

  // Scenario L: Missing Blackboard URL
  it("Scenario L: item without Blackboard URL is valid and persists source_url as null", async () => {
    const res = await ingest(missingUrlEmail());
    expect(res.status).toBe("processed");

    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].source_url).toBeNull();
    expect(items[0].due_date).toBe("2026-09-25");
  });

  // Scenario M: Forwarded email formatting
  it("Scenario M: normal Outlook forwarded email structure resolves course, item, and Task correctly", async () => {
    const res = await ingest(forwardedEmail());
    expect(res.status).toBe("processed");
    expect(res.itemId).toBeTruthy();
    expect(res.taskId).toBeTruthy();

    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Assignment 1");
    expect(items[0].course_id).toBe(courseCS101);
  });

  // Scenario N: FW: / Fwd: subject prefix
  it("Scenario N: FW: / Fwd: subject prefixes do not break classification or title extraction", async () => {
    const res = await ingest(
      assignmentEmail({
        MessageID: "fwd-prefix-test",
        Subject: "FW: Fwd: RE: New assignment: Homework 3",
        TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Homework 3\nDue Date: 2026-09-30",
      }),
    );
    expect(res.status).toBe("processed");

    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Homework 3");
  });

  // Scenario O: Malformed Blackboard email
  it("Scenario O: malformed email (invalid date or ambiguous fields) yields safe malformed status and NO Task", async () => {
    const malformed = await ingest(
      assignmentEmail({
        MessageID: "malformed-1",
        TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: next week sometime",
      }),
    );
    expect(malformed.status).toBe("malformed");
    expect(malformed.itemId).toBeNull();
    expect(malformed.taskId).toBeNull();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  // Scenario P: Unrelated School email
  it("Scenario P: unrelated email mentioning 'Blackboard' from untrusted sender is safely ignored", async () => {
    const unrelated = await ingest(unrelatedSchoolEmail());
    expect(unrelated.status).toBe("ignored");
    expect(unrelated.itemId).toBeNull();
    expect(unrelated.taskId).toBeNull();

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  // Scenario Q: Spoof-like Blackboard message
  it("Scenario Q: spoofed Blackboard message failing DKIM authentication is rejected as unauthenticated", async () => {
    const spoofed = await ingest(spoofedBlackboardEmail());
    expect(spoofed.status).toBe("ignored");

    const items = await getItems();
    const tasks = await getTasks();
    expect(items).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  // Scenario R: Retry after transaction failure
  it("Scenario R: rollback upon simulated failure cleans up completely; retry succeeds without duplicate rows", async () => {
    // Install a trigger to simulate a failure during task insert
    await db.exec(`
      reset role;
      create function fail_test_trigger() returns trigger language plpgsql as $$
      begin
        raise exception 'simulated failure in transaction';
      end;
      $$;
      create trigger trigger_simulated_fail before insert on tasks for each row execute function fail_test_trigger();
      set role service_role;
    `);

    // Ingestion should fail and roll back the whole transaction
    await expect(ingest(assignmentEmail())).rejects.toThrow("simulated failure in transaction");

    // Verify nothing was persisted
    expect(await getItems()).toHaveLength(0);
    expect(await getTasks()).toHaveLength(0);
    expect((await db.query("select id from school_email_events")).rows).toHaveLength(0);

    // Remove the failure trigger
    await db.exec(`
      reset role;
      drop trigger trigger_simulated_fail on tasks;
      drop function fail_test_trigger();
      set role service_role;
    `);

    // Ingest now succeeds cleanly
    const retryRes = await ingest(assignmentEmail());
    expect(retryRes.status).toBe("processed");
    expect(await getItems()).toHaveLength(1);
    expect(await getTasks()).toHaveLength(1);
  });

  // Scenario S: Deleted linked Task behavior
  it("Scenario S: when user deletes a linked Task, subsequent reminders or deadline changes DO NOT silently recreate the Task", async () => {
    // 1. Initial assignment ingestion creates item and linked Task
    const initial = await ingest(assignmentEmail());
    expect(initial.status).toBe("processed");
    expect(initial.taskId).toBeTruthy();

    const initialTasks = await getTasks();
    expect(initialTasks).toHaveLength(1);

    // 2. User deletes the task in Redline
    await db.query("delete from tasks where id = $1", [initial.taskId]);
    expect(await getTasks()).toHaveLength(0);

    // 3. A reminder email arrives for that same assignment
    const reminderRes = await ingest(reminderEmail());
    // The backend recognizes that task_created was true, so it does not recreate the task!
    expect(reminderRes.status).toBe("unresolved_task");

    // 4. Verify no task was recreated
    const finalTasks = await getTasks();
    expect(finalTasks).toHaveLength(0);

    // 5. School item still exists, but task_id remains null (preserved user intention)
    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].task_id).toBeNull();
  });
});
