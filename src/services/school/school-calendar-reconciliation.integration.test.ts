import { readFileSync, readdirSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let account: string;
let course: string;
let hashCounter = 0;

function observation(overrides: Record<string, unknown> = {}) {
  hashCounter += 1;
  return {
    uid: "calendar-uid-1@example.invalid",
    title: "Assignment 1",
    titleKey: "assignment 1",
    description: "Course: CS101\nType: Assignment",
    sourceUrl: "https://learn.example.edu/item?course_id=_101_1&content_id=_201_1",
    candidateSourceKey: "learn.example.edu:content_id:_201_1",
    candidateCourseKey: "learn.example.edu:_101_1",
    courseCode: "CS101",
    courseName: null,
    itemType: "assignment",
    classificationReason: "category",
    startsAt: null,
    dueAt: null,
    dueDate: "2026-09-18",
    duePrecision: "date",
    contentHash: hashCounter.toString(16).padStart(64, "0"),
    proposalRevision: "f".repeat(64),
    sourceUpdatedAt: "2026-09-10T02:00:00.000Z",
    sourceRevision: `sequence:${hashCounter};modified:2026-09-10T02:00:00.000Z`,
    isFallbackUid: false,
    recurrence: false,
    status: "CONFIRMED",
    rawMetadata: {
      parserVersion: "blackboard-calendar-v2",
      fields: ["uid", "summary", "dtstart"],
      sequence: hashCounter,
      hasRecurrenceRule: false,
      hasRecurrenceId: false,
      xProperties: [],
    },
    ...overrides,
  };
}

async function startRun(mode: "observe" | "apply") {
  await db.query("update integration_accounts set blackboard_sync_mode=$2 where id=$1", [account, mode]);
  return (
    await db.query<{ id: string }>(
      "insert into sync_runs(user_id,account_id,idempotency_key,sync_mode) values($1,$2,gen_random_uuid(),$3) returning id",
      [owner, account, mode],
    )
  ).rows[0].id;
}

async function reconcile(
  mode: "observe" | "apply",
  observations: unknown[],
) {
  const run = await startRun(mode);
  const result = await db.query<{ result: Record<string, unknown> }>(
    "select public.reconcile_blackboard_calendar_snapshot($1,$2,$3,$4::jsonb) result",
    [owner, account, run, JSON.stringify(observations)],
  );
  return { run, result: result.rows[0].result };
}

async function ingestEmail(overrides: Record<string, unknown> = {}) {
  const event = {
    source: "blackboard",
    provider: "postmark",
    sourceMessageId: `message-${hashCounter}`,
    messageKey: (hashCounter + 100).toString(16).padStart(64, "0"),
    receivedAt: "2026-09-10T02:01:00.000Z",
    sourceAt: "2026-09-10T02:00:00.000Z",
    parserVersion: "blackboard-email-v1",
    status: "parsed",
    notificationType: "assignment",
    itemType: "assignment",
    courseHint: "CS101",
    courseKey: "learn.example.edu:_101_1",
    title: "Assignment 1",
    titleKey: "assignment 1",
    sourceKey: "learn.example.edu:content_id:_201_1",
    sourceUrl: "https://learn.example.edu/item?course_id=_101_1&content_id=_201_1",
    dueDate: "2026-09-18",
    dueAt: null,
    duePrecision: "date",
    weight: 15,
    evidence: "synthetic",
    reason: null,
    ...overrides,
  };
  return (
    await db.query<{ result: { status: string; itemId: string | null; taskId: string | null } }>(
      "select public.ingest_school_email($1,$2::jsonb) result",
      [owner, JSON.stringify(event)],
    )
  ).rows[0].result;
}

async function state() {
  const items = (
    await db.query<{
      id: string;
      task_id: string | null;
      task_created: boolean;
      course_id: string;
      source_key: string | null;
      due_date: string | null;
      weight: number | null;
    }>("select id,task_id,task_created,course_id,source_key,due_date::text,weight::float from school_items order by created_at")
  ).rows;
  const tasks = (
    await db.query<{ id: string; course_id: string | null; due_date: string | null }>(
      "select id,course_id,due_date::text from tasks order by created_at",
    )
  ).rows;
  return { items, tasks };
}

describe("Blackboard S2 calendar reconciliation through actual PostgreSQL migrations", () => {
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
    for (const file of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.query("insert into auth.users values($1),($2)", [owner, foreign]);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    hashCounter = 0;
    await db.exec(`
      reset role;
      delete from sync_changes; delete from sync_runs; delete from external_records;
      delete from blackboard_course_mappings; delete from school_email_events;
      delete from school_items; delete from school_course_mappings;
      delete from integration_accounts; delete from tasks; delete from courses;
    `);
    course = (
      await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'CS101','Computer Science') returning id",
        [owner],
      )
    ).rows[0].id;
    account = (
      await db.query<{ id: string }>(
        "insert into integration_accounts(user_id,provider,encrypted_credential,credential_hint) values($1,'blackboard','fixture','learn.example.edu') returning id",
        [owner],
      )
    ).rows[0].id;
    await db.exec("set role service_role");
  });

  it("stores repeated identical snapshots idempotently in observe mode without School mutations", async () => {
    const firstObservation = observation();
    const first = await reconcile("observe", [firstObservation]);
    const second = await reconcile("observe", [firstObservation]);
    expect(first.result).toMatchObject({ mode: "observe", created: 1, applied: 0 });
    expect(second.result).toMatchObject({ mode: "observe", created: 0, updated: 0, applied: 0 });
    expect(await state()).toEqual({ items: [], tasks: [] });
    expect((await db.query("select id from external_records")).rows).toHaveLength(1);
  });

  it("backfills missed email work from a deterministic current-state item", async () => {
    const result = await reconcile("apply", [observation()]);
    const current = await state();
    expect(result.result).toMatchObject({ applied: 1, unresolved: 0 });
    expect(current.items).toHaveLength(1);
    expect(current.tasks).toHaveLength(1);
    expect(current.items[0]).toMatchObject({ task_id: current.tasks[0].id, due_date: "2026-09-18" });
  });

  it("links email-first work without replacing IDs or rolling back its deadline", async () => {
    const email = await ingestEmail({ dueDate: "2026-09-21" });
    const result = await reconcile("apply", [observation({ dueDate: "2026-09-18" })]);
    const current = await state();
    expect(result.result).toMatchObject({ applied: 0 });
    expect(current.items).toHaveLength(1);
    expect(current.items[0]).toMatchObject({ id: email.itemId, task_id: email.taskId, due_date: "2026-09-21", weight: 15 });
    expect(current.tasks[0]).toMatchObject({ id: email.taskId, due_date: "2026-09-21" });
  });

  it("lets later email converge on a calendar-created item and stable Task", async () => {
    await reconcile("apply", [observation()]);
    const before = await state();
    const email = await ingestEmail();
    const after = await state();
    expect(email).toMatchObject({ status: "processed", itemId: before.items[0].id, taskId: before.tasks[0].id });
    expect(after.items).toHaveLength(1);
    expect(after.tasks).toHaveLength(1);
  });

  it("updates the same School item and Task after the calendar observation materially advances", async () => {
    await reconcile("apply", [observation({ dueDate: "2026-09-18" })]);
    const before = await state();
    await reconcile("apply", [observation({ dueDate: "2026-09-21" })]);
    const after = await state();
    expect(after.items[0]).toMatchObject({ id: before.items[0].id, task_id: before.tasks[0].id, due_date: "2026-09-21" });
    expect(after.tasks[0]).toMatchObject({ id: before.tasks[0].id, due_date: "2026-09-21" });
  });

  it("prevents stale unchanged ICS rollback, then converges when ICS itself changes", async () => {
    const friday = observation({ dueDate: "2026-09-18" });
    await reconcile("apply", [friday]);
    await ingestEmail({
      sourceMessageId: "deadline-message",
      messageKey: "d".repeat(64),
      notificationType: "deadline_changed",
      dueDate: "2026-09-21",
      sourceAt: "2026-09-11T02:00:00.000Z",
    });
    await reconcile("apply", [friday]);
    expect((await state()).tasks[0].due_date).toBe("2026-09-21");
    await reconcile("apply", [observation({ dueDate: "2026-09-21" })]);
    const converged = await state();
    expect(converged.items[0].due_date).toBe("2026-09-21");
    expect(converged.tasks[0].due_date).toBe("2026-09-21");
  });

  it("keeps conflicting strong identities separate and same titles course-scoped", async () => {
    await reconcile("apply", [
      observation(),
      observation({ uid: "calendar-uid-2@example.invalid", candidateSourceKey: "learn.example.edu:content_id:_202_1" }),
    ]);
    const secondCourse = (
      await db.query<{ id: string }>(
        "insert into courses(user_id,code,name) values($1,'MATH201','Calculus') returning id",
        [owner],
      )
    ).rows[0].id;
    await db.query(
      "insert into school_course_mappings(user_id,source_course_key,course_id) values($1,'learn.example.edu:_202_1',$2)",
      [owner, secondCourse],
    );
    await reconcile("apply", [
      observation({ uid: "calendar-uid-3@example.invalid", candidateCourseKey: "learn.example.edu:_202_1", candidateSourceKey: "learn.example.edu:content_id:_301_1", courseCode: "MATH201" }),
    ]);
    const current = await state();
    expect(current.items).toHaveLength(3);
    expect(new Set(current.items.map((item) => item.id)).size).toBe(3);
    expect(new Set(current.items.map((item) => item.course_id))).toEqual(new Set([course, secondCourse]));
  });

  it("fails closed on ambiguous courses", async () => {
    await db.query("insert into courses(user_id,code,name) values($1,'cs101','Alternate Computer Science')", [owner]);
    const result = await reconcile("apply", [observation({ candidateCourseKey: null })]);
    expect(result.result).toMatchObject({ unresolved: 1, applied: 0 });
    expect(await state()).toEqual({ items: [], tasks: [] });
  });

  it("does not assume UID equals source key and allows multiple observations to link one School item", async () => {
    await reconcile("apply", [observation()]);
    const before = await state();
    await reconcile("apply", [
      observation({ uid: "different-calendar-uid@example.invalid", dueDate: "2026-09-18" }),
    ]);
    const links = (
      await db.query<{ school_item_id: string | null }>(
        "select school_item_id from external_records where school_item_id is not null order by created_at",
      )
    ).rows;
    expect(links).toHaveLength(2);
    expect(new Set(links.map((link) => link.school_item_id))).toEqual(new Set([before.items[0].id]));
    expect((await state()).tasks).toHaveLength(1);
  });

  it("never recreates a user-deleted linked Task", async () => {
    await reconcile("apply", [observation()]);
    const before = await state();
    await db.query("delete from tasks where id=$1", [before.tasks[0].id]);
    const result = await reconcile("apply", [observation({ dueDate: "2026-09-22" })]);
    expect(result.result).toMatchObject({ unresolved: 1, applied: 0 });
    const after = await state();
    expect(after.tasks).toHaveLength(0);
    expect(after.items[0]).toMatchObject({ id: before.items[0].id, task_id: null, task_created: true, due_date: "2026-09-18" });
  });

  it("marks absence only after a successful complete snapshot and never deletes canonical data", async () => {
    await reconcile("apply", [observation()]);
    await reconcile("apply", []);
    expect((await db.query("select missing_since from external_records")).rows[0]).toMatchObject({ missing_since: expect.any(Date) });
    const current = await state();
    expect(current.items).toHaveLength(1);
    expect(current.tasks).toHaveLength(1);
  });

  it("rolls back an invalid snapshot without marking prior observations missing", async () => {
    await reconcile("observe", [observation()]);
    const run = await startRun("observe");
    await expect(
      db.query("select public.reconcile_blackboard_calendar_snapshot($1,$2,$3,$4::jsonb)", [
        owner,
        account,
        run,
        JSON.stringify([{ uid: "invalid" }]),
      ]),
    ).rejects.toThrow();
    expect((await db.query("select missing_since from external_records")).rows[0]).toMatchObject({ missing_since: null });
  });
});
