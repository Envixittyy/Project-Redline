import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { normalizePostmarkEmail } from "@/services/integrations/email/postmark";
import { parseBlackboardEmail } from "./email-parser";
import {
  assignmentEmail,
  deadlineEmail,
  emailPolicy,
} from "./fixtures/email-fixtures";
import type { SchoolIngestionResult } from "@/types/school-item";

const owner = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
let courseId: string;

const rootFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

async function ingest(payload = assignmentEmail()): Promise<SchoolIngestionResult> {
  const event = parseBlackboardEmail(
    normalizePostmarkEmail(payload, "2026-09-08T02:01:00Z"),
    emailPolicy,
  );
  return (
    await db.query<{ result: SchoolIngestionResult }>(
      "select public.ingest_school_email($1, $2::jsonb) result",
      [owner, JSON.stringify(event)],
    )
  ).rows[0].result;
}

describe("Blackboard Email-Only Architecture & S2 Retirement", () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function auth.role() returns text language sql stable as $$
        select current_setting('role', true)
      $$;
      grant usage on schema auth, public to authenticated, anon, service_role;
      grant execute on all functions in schema auth to authenticated, anon, service_role;
      alter default privileges in schema public grant all on tables to authenticated, service_role;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects(id uuid, name text, bucket_id text);
    `);

    for (const file of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.query("insert into auth.users values($1)", [owner]);
  }, 60000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec(`
      reset role;
      delete from school_email_events;
      delete from school_items;
      delete from school_course_mappings;
      delete from tasks;
      delete from courses;
    `);
    courseId = (
      await db.query<{ id: string }>(
        "insert into courses(user_id, code, name) values($1, 'CS101', 'Computer Science') returning id",
        [owner],
      )
    ).rows[0].id;
    await db.exec("set role service_role");
  });

  describe("1. Email Ingestion: Task Creation, Updates, and Idempotency", () => {
    it("creates exactly one school item and linked Task upon receiving an assignment email", async () => {
      const result = await ingest();
      expect(result.status).toBe("processed");
      expect(result.itemId).toBeTruthy();
      expect(result.taskId).toBeTruthy();

      const items = (
        await db.query<{
          id: string;
          task_id: string;
          course_id: string;
          item_type: string;
          title: string;
          due_date: string;
        }>("select id, task_id, course_id, item_type, title, due_date::text from school_items")
      ).rows;

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        course_id: courseId,
        title: "Assignment 1",
        item_type: "assignment",
        due_date: "2026-09-15",
      });

      const tasks = (
        await db.query<{ id: string; title: string; due_date: string }>(
          "select id, title, due_date::text from tasks",
        )
      ).rows;

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: items[0].task_id,
        title: "Assignment 1",
        due_date: "2026-09-15",
      });
    });

    it("updates existing school item and linked Task when a deadline change email arrives", async () => {
      const initial = await ingest();
      expect(initial.status).toBe("processed");

      const changeResult = await ingest(deadlineEmail());
      expect(changeResult.status).toBe("processed");
      expect(changeResult.itemId).toBe(initial.itemId);
      expect(changeResult.taskId).toBe(initial.taskId);

      const items = (
        await db.query<{ id: string; due_date: string }>(
          "select id, due_date::text from school_items",
        )
      ).rows;
      expect(items).toHaveLength(1);
      expect(items[0].due_date).toBe("2026-09-18");

      const tasks = (
        await db.query<{ id: string; due_date: string }>(
          "select id, due_date::text from tasks",
        )
      ).rows;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].due_date).toBe("2026-09-18");
    });

    it("remains idempotent and does not create duplicates when the same email is ingested again", async () => {
      const first = await ingest();
      expect(first.status).toBe("processed");

      const duplicate = await ingest();
      expect(duplicate.status).toBe("duplicate");

      const itemsCount = (await db.query<{ count: string | number }>("select count(*) from school_items")).rows[0];
      const tasksCount = (await db.query<{ count: string | number }>("select count(*) from tasks")).rows[0];
      expect(Number(itemsCount.count)).toBe(1);
      expect(Number(tasksCount.count)).toBe(1);
    });
  });

  describe("2. Database Schema: S2 Calendar / ICS Entities Completely Retired", () => {
    it("drops legacy Blackboard calendar procedures from the database", async () => {
      const procs = (
        await db.query<{ proname: string }>(
          `select proname from pg_proc where proname in (
            'reconcile_blackboard_calendar_snapshot',
            'bulk_assign_blackboard_records',
            'upsert_blackboard_course_mapping',
            'enforce_blackboard_sync_mode_activation',
            'enforce_blackboard_s2_audit_owner'
          )`,
        )
      ).rows;

      expect(procs).toEqual([]);
    });

    it("drops blackboard_course_mappings table", async () => {
      const tables = (
        await db.query<{ tablename: string }>(
          "select tablename from pg_tables where schemaname = 'public' and tablename = 'blackboard_course_mappings'",
        )
      ).rows;

      expect(tables).toHaveLength(0);
    });

    it("drops S2 calendar columns from external_records and integration_accounts", async () => {
      const cols = (
        await db.query<{ table_name: string; column_name: string }>(
          `select table_name, column_name from information_schema.columns
           where table_schema = 'public' and column_name in (
             'calendar_source_key',
             'calendar_course_key',
             'calendar_source_revision',
             'school_applied_hash',
             'school_item_id',
             'blackboard_sync_mode',
             'snapshot_complete'
           )`,
        )
      ).rows;

      expect(cols).toEqual([]);
    });

    it("removes S2 triggers", async () => {
      const triggers = (
        await db.query<{ tgname: string }>(
          `select tgname from pg_trigger where tgname in (
            'blackboard_s2_sync_mode_activation',
            'blackboard_s2_sync_runs_owner',
            'blackboard_s2_sync_changes_owner'
          )`,
        )
      ).rows;

      expect(triggers).toEqual([]);
    });
  });

  describe("3. Preservation of Tasks: Deleting Legacy Calendar Data Never Deletes Tasks", () => {
    it("preserves task when legacy calendar external record relationship is cleaned up", async () => {
      // Simulate existing Task 'GED102 CO2L3B Linear Programming'
      const taskRow = (
        await db.query<{ id: string }>(
          `insert into tasks (user_id, title, due_date)
           values ($1, 'GED102 CO2L3B Linear Programming', '2026-09-25')
           returning id`,
          [owner],
        )
      ).rows[0];

      // Simulate a legacy external record referencing this task
      const accRow = (
        await db.query<{ id: string }>(
          `insert into integration_accounts (user_id, provider, encrypted_credential)
           values ($1, 'blackboard', 'fake-enc')
           returning id`,
          [owner],
        )
      ).rows[0];

      const extRecRow = (
        await db.query<{ id: string }>(
          `insert into external_records (user_id, account_id, provider, external_uid, task_id, normalized_title, content_hash)
           values ($1, $2, 'blackboard', 'leg-uid-1', $3, 'GED102 CO2L3B Linear Programming', 'hash-1')
           returning id`,
          [owner, accRow.id, taskRow.id],
        )
      ).rows[0];

      // Verify the cleanup migration pattern:
      // First detach task_id, then delete external_record
      await db.query("update external_records set task_id = null where id = $1", [extRecRow.id]);
      await db.query("delete from external_records where id = $1", [extRecRow.id]);

      // The Task itself MUST remain intact
      const survivingTask = (
        await db.query<{ id: string; title: string; due_date: string }>(
          "select id, title, due_date::text from tasks where id = $1",
          [taskRow.id],
        )
      ).rows[0];

      expect(survivingTask).toBeDefined();
      expect(survivingTask.title).toBe("GED102 CO2L3B Linear Programming");
      expect(survivingTask.due_date).toBe("2026-09-25");
    });
  });

  describe("4. Main Calendar Decoupling", () => {
    it("external calendar repository does not query Blackboard or external_records", () => {
      const extCalRepo = rootFile("src/services/external-calendars/external-calendar-repository.ts");

      expect(extCalRepo).not.toContain("listBlackboardCalendarProjectionsInRange");
      expect(extCalRepo).not.toContain("blackboard");
      expect(extCalRepo).not.toContain("external_records");
    });

    it("calendar source items omit blackboard_event", () => {
      const sourceContract = rootFile("src/features/calendar/calendar-source-contract.ts");
      expect(sourceContract).not.toContain("blackboard_event");
      expect(sourceContract).not.toContain('sourceItem.type === "blackboard_event"');
    });
  });

  describe("5. UI & Codebase Hygiene: Zero S2 / iCal References", () => {
    it("BlackboardPanel contains no private feed or sync controls", () => {
      const panel = rootFile("src/features/integrations/blackboard-panel.tsx");

      expect(panel).not.toContain("Private iCalendar");
      expect(panel).not.toContain("observe mode");
      expect(panel).not.toContain("apply mode");
      expect(panel).not.toContain("Sync now");
      expect(panel).not.toContain("syncBlackboardAction");
      expect(panel).not.toContain("characterizeBlackboardAction");
      expect(panel).not.toContain("configureBlackboardAction");
    });

    it("workspace integration and more pages reference email-only updates", () => {
      const page = rootFile("src/app/(workspace)/integrations/blackboard/page.tsx");
      const more = rootFile("src/app/(workspace)/more/page.tsx");

      expect(page).toContain("Automatic school updates from Blackboard notification emails");
      expect(page).not.toContain("Private iCalendar");
      expect(page).not.toContain("observe mode");

      expect(more).toContain("Automatic school updates from notification emails");
      expect(more).not.toContain("Secure calendar sync");
    });

    it("package.json does not depend on node-ical", () => {
      const pkg = JSON.parse(rootFile("package.json"));
      expect(pkg.dependencies?.["node-ical"]).toBeUndefined();
      expect(pkg.devDependencies?.["node-ical"]).toBeUndefined();
    });
  });
});
