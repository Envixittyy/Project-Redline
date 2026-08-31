import { readFileSync, readdirSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseNoteRewriteOutput, parseNoteActionItemsOutput } from "@/services/integrations/ai/note-intelligence-contract";
import { parseQuickCaptureOutput } from "@/services/integrations/ai/quick-capture-contract";
import { parseScheduleOutput } from "@/services/integrations/ai/school-schedule-contract";

// Historical exploit evidence, NOT tests certifying active feature behavior.
// Keep this database pinned to the submitted repair migration. The full-chain
// ai-trust suite separately proves that final containment blocks these RPCs.
const checkpoint = "20260831150000_school_intelligence_repair.sql";
const owner = "11111111-1111-4111-8111-111111111111";
const key = Buffer.alloc(32, 7);
let db: PGlite;

async function rpc(name: string, operation: string, data: Record<string, unknown>) {
  const message = JSON.stringify({ version: 1, user_id: owner, operation, expires: Math.floor(Date.now() / 1000) + 60, data });
  const mac = createHmac("sha256", key).update(message).digest("hex");
  return (await db.query<{ result: Record<string, unknown> | string }>(`select public.${name}($1,$2) result`, [message, mac])).rows[0].result;
}
async function review(capability: string, proposal: Record<string, unknown>, source = "canonical source snapshot") {
  const id = randomUUID();
  await rpc("ai_create_scoped_request", "prepare_scoped_request", {
    id, capability, source_handle: "source_fixture", source_text: source,
    source_digest: createHash("sha256").update(source).digest("hex"),
    file_name: "source.txt", start_date: "2026-08-31", time_zone: "Asia/Manila", provider: "ollama", model: "fixture",
  });
  const batch = await rpc("ai_record_scoped_proposal", "record_scoped_proposal", { request_id: id, proposal });
  return readReview(batch as string);
}
async function readReview(batch: string) {
  const row = (await db.query<{ r: { batchId: string; proposalDigest: string; input: Record<string, unknown> } }>("select ai_read_scoped_review($1) r", [batch])).rows[0].r;
  return { ...row, batch_id: row.batchId, proposal_digest: row.proposalDigest };
}
const calendarEvent = (title: string, date: string) => ({ title, startDate: date, allDay: true, eventType: "holiday" });
const calendarProposal = (events: unknown[]) => ({ schema_version: 1, type: "import_academic_calendar", source_handle: "source_fixture", events });
async function note(body = "original") {
  return (await db.query<{ id: string }>("insert into notes(user_id,title,body) values($1,'Note',$2) returning id", [owner, body])).rows[0].id;
}
async function prediction() {
  const course = (await db.query<{ id: string }>("insert into courses(user_id,code,name) values($1,'CS101','Computing') returning id", [owner])).rows[0].id;
  await db.exec("reset role");
  const id = (await db.query<{ id: string }>("insert into school_assessment_predictions(user_id,course_id,prediction_type,title,predicted_date,predicted_time,confidence,rationale) values($1,$2,'quiz','Reviewed quiz','2026-09-10','09:00','HIGH','fixture') returning id", [owner, course])).rows[0].id;
  await db.exec("set role authenticated");
  return id;
}

describe("Submitted repair checkpoint: independently reproduced defects (not activation approval)", () => {
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
    for (const file of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql") && n <= checkpoint).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.query("insert into ai_private.signing_key(secret) values($1)", [key]);
    await db.query("insert into auth.users(id) values($1)", [owner]);
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("reset role; truncate operation_batches, ai_scoped_requests, tasks, notes, courses, calendar_events, ai_preferences cascade; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  });

  it("collapses two distinct same-title calendar entries into one event", async () => {
    const r = await review("academicCalendarImport.propose", calendarProposal([calendarEvent("Holiday", "2026-09-01"), calendarEvent("Holiday", "2026-12-25")]));
    expect(await rpc("apply_ai_academic_calendar", "approve_academic_calendar", r)).toMatchObject({ created: 1, updated: 1 });
    const rows = (await db.query<{ starts_at: string }>("select starts_at::text from calendar_events")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].starts_at).toContain("2026-12-25");
  });

  it("overwrites manual divergence and lets an older review overwrite a newer import", async () => {
    const old = await review("academicCalendarImport.propose", calendarProposal([calendarEvent("Holiday", "2026-09-01")]));
    const fresh = await review("academicCalendarImport.propose", calendarProposal([calendarEvent("Holiday", "2026-09-05")]), "revised source");
    await rpc("apply_ai_academic_calendar", "approve_academic_calendar", fresh);
    await db.query("update calendar_events set description='Keep my manual edit'");
    await rpc("apply_ai_academic_calendar", "approve_academic_calendar", old);
    const row = (await db.query<{ description: string | null; starts_at: string }>("select description,starts_at::text from calendar_events")).rows[0];
    expect(row.description).toBeNull();
    expect(row.starts_at).toContain("2026-09-01");
  });

  it("accepts browser prediction title/date/priority substitution with no provenance link", async () => {
    const id = await prediction();
    await rpc("confirm_prediction_to_task", "confirm_prediction_task", { prediction_id: id, title: "Substituted task", dueDate: "2030-01-01", priority: "urgent" });
    const row = (await db.query<{ title: string; due_date: string; due_at: string }>("select title,due_date::text,due_at::text from tasks")).rows[0];
    expect(row.title).toBe("Substituted task");
    expect(row.due_date).toBe("2030-01-01");
    expect(new Date(row.due_at).toISOString()).toBe("2026-09-10T09:00:00.000Z");
    expect((await db.query("select * from operation_steps")).rows).toHaveLength(0);
  });

  it("accepts browser prediction event title and ignores the stored local time", async () => {
    const id = await prediction();
    await rpc("confirm_prediction_to_event", "confirm_prediction_event", { prediction_id: id, title: "Substituted event" });
    expect((await db.query("select title,all_day from calendar_events")).rows).toEqual([{ title: "Substituted event", all_day: true }]);
  });

  it("serializes queued confirmation/replay and rejects terminal predictions", async () => {
    const id = await prediction();
    // PGlite has one connection: proves queued replay, not a live PostgreSQL race.
    const results = await Promise.all([rpc("confirm_prediction_to_task", "confirm_prediction_task", { prediction_id: id }), rpc("confirm_prediction_to_event", "confirm_prediction_event", { prediction_id: id })]);
    expect(results.filter(r => typeof r !== "string" && r.ok)).toHaveLength(1);
    expect((await db.query("select * from tasks")).rows).toHaveLength(1);
    for (const status of ["dismissed", "superseded"]) {
      await db.exec("reset role; truncate school_assessment_predictions, courses cascade; set role authenticated;");
      const terminal = await prediction();
      await db.exec("reset role");
      await db.query("update school_assessment_predictions set status=$1 where id=$2", [status, terminal]);
      await db.exec("set role authenticated");
      expect(await rpc("confirm_prediction_to_task", "confirm_prediction_task", { prediction_id: terminal })).toMatchObject({ ok: false });
    }
  });

  it("real rewrite contract fails because SQL reads rewritten_body instead of rewrittenBody", async () => {
    const nid = await note();
    const proposal = parseNoteRewriteOutput(JSON.stringify({ schema_version: 1, type: "propose_note_rewrite", source_handle: "source_fixture", rewrittenBody: "Reviewed replacement", changesExplanation: "Cleaned up" }), "noteRewrite.propose", "source_fixture");
    const r = await review("noteRewrite.propose", proposal);
    await expect(rpc("apply_ai_note_rewrite", "approve_note_rewrite", { ...r, note_id: nid })).rejects.toThrow(/null value/);
    expect((await db.query("select body from notes")).rows).toEqual([{ body: "original" }]);
    expect((await readReview(r.batchId)).input).toEqual(proposal);
  });

  it("SQL's accepted rewrite shape can overwrite a different and stale owner Note", async () => {
    const source = await note("source note");
    const target = await note("unrelated note");
    const r = await review("noteRewrite.propose", { rewritten_body: "Overwritten" }, `note ${source}: source note`);
    await db.query("update notes set body='newer manual edit' where id=$1", [target]);
    await rpc("apply_ai_note_rewrite", "approve_note_rewrite", { ...r, note_id: target });
    expect((await db.query("select body from notes where id=$1", [target])).rows).toEqual([{ body: "Overwritten" }]);
  });

  it("real action-items contract is consumed successfully without creating its Tasks", async () => {
    const nid = await note();
    const proposal = parseNoteActionItemsOutput(JSON.stringify({ schema_version: 1, type: "propose_note_action_items", source_handle: "source_fixture", actionItems: [{ title: "Reviewed task" }] }), "noteActionItems.propose", "source_fixture");
    const r = await review("noteActionItems.propose", proposal);
    expect(await rpc("apply_ai_note_action_items", "approve_note_action_items", { ...r, note_id: nid })).toMatchObject({ ok: true, count: 0 });
    expect((await db.query("select * from tasks")).rows).toHaveLength(0);
  });

  it("real Quick Capture Task/Event contracts cannot be applied by SQL", async () => {
    for (const captured of [{ entityType: "task", title: "Task" }, { entityType: "calendar_event", title: "Event", startDate: "2026-09-01", startTime: "09:00", endTime: "10:00", allDay: false }]) {
      const proposal = parseQuickCaptureOutput(JSON.stringify({ schema_version: 1, type: "propose_quick_capture", source_handle: "source_fixture", captured, confidence: "HIGH" }), "quickCapture.propose", "source_fixture");
      const r = await review("quickCapture.propose", proposal);
      await expect(rpc("apply_ai_quick_capture", "approve_quick_capture", r)).rejects.toThrow(/ai_invalid_proposal/);
    }
  });

  it("SQL's accepted Quick Capture shape incorrectly treats Manila wall time as UTC", async () => {
    const r = await review("quickCapture.propose", { capture_type: "task", task: { title: "Meeting", dueDate: "2026-09-01", dueTime: "09:00" } });
    await rpc("apply_ai_quick_capture", "approve_quick_capture", r);
    expect(new Date((await db.query<{ due_at: string }>("select due_at::text from tasks")).rows[0].due_at).toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("schedule reimport duplicates meetings and ignores suggest-only permission", async () => {
    await db.query("insert into ai_preferences(user_id,permission_mode) values($1,'suggest_only')", [owner]);
    const proposal = parseScheduleOutput(JSON.stringify({ schema_version: 1, type: "import_schedule", source_handle: "source_fixture", courses: [{ code: "CS101", title: "Computing", meetings: [{ weekday: "monday", startTime: "09:00", endTime: "10:00" }] }] }), "schoolScheduleImage.propose", "source_fixture");
    for (let i = 0; i < 2; i++) await rpc("apply_ai_schedule_import", "approve_schedule_import", await review("schoolScheduleImage.propose", proposal));
    expect((await db.query("select * from courses")).rows).toHaveLength(1);
    expect((await db.query("select * from course_meetings")).rows).toHaveLength(2);
  });

  it("successor review accepts arbitrary type/source handle and invalid weekday", async () => {
    const r = await review("schoolScheduleImage.propose", { courses: [] });
    const next = await rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: r.batchId, proposal: { type: "arbitrary_operation", source_handle: "different_source", courses: [{ code: "CS999", title: "Unvalidated", meetings: [{ weekday: "not-a-day", startTime: "09:00", endTime: "10:00" }] }] } });
    const successor = await readReview(next as string);
    await rpc("apply_ai_schedule_import", "approve_schedule_import", successor);
    expect((await db.query("select weekdays from course_meetings")).rows).toEqual([{ weekdays: [1] }]);
    await expect(rpc("apply_ai_schedule_import", "approve_schedule_import", r)).rejects.toThrow(/ai_proposal_unavailable/);
  });

  it("rejects unrelated capability, changed review digest, and expired approval", async () => {
    const r = await review("academicCalendarImport.propose", calendarProposal([calendarEvent("Holiday", "2026-09-01")]));
    await expect(rpc("apply_ai_schedule_import", "approve_schedule_import", r)).rejects.toThrow(/ai_untrusted_proposal/);
    await expect(rpc("apply_ai_academic_calendar", "approve_academic_calendar", { ...r, proposal_digest: "0".repeat(64) })).rejects.toThrow(/ai_review_changed/);
    await db.exec("reset role; update ai_scoped_requests set expires_at=now()-interval '1 second'; set role authenticated;");
    await expect(rpc("apply_ai_academic_calendar", "approve_academic_calendar", r)).rejects.toThrow(/ai_proposal_unavailable/);
  });

  it("prediction generation permits a different owned course from its selected source", async () => {
    const courses = (await db.query<{ id: string }>("insert into courses(user_id,code,name) values($1,'A','Selected'),($1,'B','Unselected') returning id", [owner])).rows;
    const r = await review("schoolAssessmentPrediction.propose", { schema_version: 1, type: "propose_assessment_predictions", source_handle: "source_fixture", predictions: [{ courseId: courses[1].id, title: "Quiz", predictionType: "quiz", predictedDate: "2026-09-10", confidence: "HIGH", rationale: "unselected course" }] }, `Selected course: ${courses[0].id}`);
    await rpc("apply_ai_assessment_predictions", "approve_assessment_predictions", r);
    expect((await db.query("select course_id from school_assessment_predictions")).rows).toEqual([{ course_id: courses[1].id }]);
  });

  it("repair SQL separates all cloud consent domains before final activation denial", async () => {
    const groups: Array<[string, string[]]> = [
      ["checklist_cloud", ["taskChecklist.propose"]], ["course_import_cloud", ["courseImport.propose"]],
      ["school_schedule_cloud", ["schoolScheduleImage.propose"]], ["blackboard_course_cloud", ["blackboardCourseImage.propose"]],
      ["academic_calendar_cloud", ["academicCalendarImport.propose"]], ["assessment_prediction_cloud", ["schoolAssessmentPrediction.propose"]],
      ["notes_cloud", ["noteSummary.propose", "noteRewrite.propose", "noteActionItems.propose"]],
      ["quick_capture_cloud", ["quickCapture.propose"]], ["daily_plan_cloud", ["dailyPlanAdvice.propose"]],
      ["course_material_cloud", ["courseMaterialSummary.propose", "courseMaterialStudyQuestions.propose"]], ["contextual_assistant_cloud", ["contextualAssistant.propose"]],
    ];
    await db.query("insert into ai_preferences(user_id,cloud_enabled,ai_mode,preferred_cloud,cloud_fallback_mode) values($1,true,'auto','gemini','ask_each_time')", [owner]);
    await db.exec("reset role");
    for (const [column, allowed] of groups) {
      await db.exec(`update ai_preferences set ${groups.map(([name]) => `${name}=false`).join(',')}`);
      await db.exec(`update ai_preferences set ${column}=true`);
      for (const capability of groups.flatMap(([, capabilities]) => capabilities)) {
        expect((await db.query<{ ok: boolean }>("select ai_private.cloud_allowed($1,'gemini') ok", [capability])).rows[0].ok).toBe(allowed.includes(capability));
      }
    }
  });
});
