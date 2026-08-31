import { readFileSync, readdirSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseNoteActionItemsOutput, parseNoteRewriteOutput } from "@/services/integrations/ai/note-intelligence-contract";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const key = Buffer.alloc(32, 8);
const rewrite = "noteRewrite.propose", items = "noteActionItems.propose";
let db: PGlite;
type Review = { batchId: string; input: Record<string, unknown>; reviewDigest: string; predecessorBatchId: string | null; sourceManifest: unknown; provenance: unknown; status: string };
const proof = (operation: string, data: Record<string, unknown>, actor = owner) => {
  const message = JSON.stringify({ version: 1, user_id: actor, operation, expires: Math.floor(Date.now() / 1000) + 60, data });
  return [message, createHmac("sha256", key).update(message).digest("hex")];
};
async function rpc(name: string, operation: string, data: Record<string, unknown>, actor = owner) {
  return (await db.query<{ r: string }>(`select ${name}($1,$2) r`, proof(operation, data, actor))).rows[0].r;
}
async function note(body = "Original note") {
  return (await db.query<{ id: string }>("insert into notes(title,body) values('Selected note',$1) returning id", [body])).rows[0].id;
}
async function prepare(id: string, capability = rewrite) {
  const request = await rpc("ai_create_scoped_request", "prepare_scoped_request", {
    capability, selection: [{ kind: "note", id }], provider: "ollama", model: "fixture", time_zone: "Asia/Manila",
  });
  const row = (await db.query<{ source_handle: string; authority_digest: string; source_manifest: unknown; source_text: string }>("select source_handle,authority_digest,source_manifest,source_text from ai_scoped_requests where id=$1", [request])).rows[0];
  return { request, ...row };
}
function output(handle: string, capability = rewrite): Record<string, unknown> {
  return capability === rewrite
    ? { schema_version: 1, type: "propose_note_rewrite", source_handle: handle, rewrittenBody: " Reviewed replacement\n", changesExplanation: "Organized wording" }
    : { schema_version: 1, type: "propose_note_action_items", source_handle: handle, actionItems: [{ title: "Reviewed task", dueDate: "2028-02-29", priority: "high" }] };
}
async function read(batch: string) {
  return (await db.query<{ r: Review }>("select ai_read_scoped_review($1) r", [batch])).rows[0].r;
}
async function proposed(id: string, capability = rewrite) {
  const r = await prepare(id, capability), proposal = output(r.source_handle, capability);
  const batch = await rpc("ai_record_scoped_proposal", "record_scoped_proposal", { request_id: r.request, proposal });
  return { ...r, batch, proposal };
}
const apply = (batch: string, extra = {}) => rpc("test_only.apply_note", `approve_scoped:${rewrite}`, { batch_id: batch, ...extra });
async function fingerprint(kind: string, id: string) {
  return (await db.query<{ r: string }>("select test_only.fingerprint($1,$2) r", [kind, id])).rows[0].r;
}

describe("Pass 1 shared authority (actual migrations; test-only fixed domain consumers)", () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('role',true) $$;
      grant usage on schema auth,public to authenticated,anon,service_role;
      grant execute on all functions in schema auth to authenticated,anon,service_role;
      alter default privileges in schema public grant all on tables to authenticated,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid,name text,bucket_id text);
    `);
    for (const file of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.query("insert into ai_private.signing_key(secret) values($1)", [key]);
    await db.query("insert into auth.users(id) values($1),($2)", [owner, foreign]);

    // Assert real deployment ACLs BEFORE selectively granting shared preparation
    // in this isolated test DB. No production Apply function is granted, replaced
    // or used. Test consumers never appear in migrations/application code.
    for (const name of ["ai_create_scoped_request", "ai_record_scoped_proposal", "ai_revise_scoped_proposal", "apply_ai_note_rewrite", "apply_ai_note_action_items", "apply_ai_schedule_import", "apply_ai_blackboard_courses", "apply_ai_academic_calendar", "apply_ai_assessment_predictions", "confirm_prediction_to_task", "confirm_prediction_to_event", "apply_ai_quick_capture"]) {
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated',$1,'execute') allowed", [`public.${name}(text,text)`])).rows[0].allowed).toBe(false);
    }
    const exposed = await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ai_private' and has_function_privilege('authenticated',p.oid,'execute')");
    expect(exposed.rows).toEqual([]);
    await db.exec(`
      grant execute on function ai_create_scoped_request(text,text),ai_record_scoped_proposal(text,text),ai_revise_scoped_proposal(text,text) to authenticated;
      create schema test_only;
      grant usage on schema test_only to authenticated;
      create function test_only.apply_note(message text,mac text) returns jsonb
      language plpgsql security definer set search_path='' as $$
      declare a jsonb; nid uuid;
      begin
        a:=ai_private.begin_scoped_apply(message,mac,'noteRewrite.propose');
        nid:=(a->'source_manifest'->0->>'id')::uuid;
        update public.notes set body=a->'proposal'->>'rewrittenBody',title=coalesce(a->'proposal'->>'rewrittenTitle',title)
          where id=nid and user_id=auth.uid();
        perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','note','ids',jsonb_build_array(nid)));
        return a;
      end $$;
      create function test_only.apply_items(message text,mac text) returns void
      language plpgsql security definer set search_path='' as $$
      declare a jsonb; item jsonb; task_id uuid; ids jsonb:='[]';
      begin
        a:=ai_private.begin_scoped_apply(message,mac,'noteActionItems.propose');
        for item in select * from jsonb_array_elements(a->'proposal'->'actionItems') loop
          insert into public.tasks(user_id,title,status,priority,due_date) values(auth.uid(),item->>'title','todo',coalesce(item->>'priority','none')::public.task_priority,(item->>'dueDate')::date) returning id into task_id;
          ids:=ids||jsonb_build_array(task_id);
        end loop;
        perform ai_private.finish_scoped_apply((a->>'batch_id')::uuid,jsonb_build_object('entity','task','ids',ids));
      end $$;
      create function test_only.unfinished(message text,mac text) returns void
      language plpgsql security definer set search_path='' as $$
      declare a jsonb;
      begin
        a:=ai_private.begin_scoped_apply(message,mac,'noteRewrite.propose');
        update public.notes set body='Must roll back' where id=(a->'source_manifest'->0->>'id')::uuid;
      end $$;
      create function test_only.fingerprint(kind text,id uuid) returns text
      language sql security definer set search_path='' as $$ select ai_private.scoped_source_fingerprint(kind,id) $$;
      revoke all on all functions in schema test_only from public,anon;
      grant execute on all functions in schema test_only to authenticated;
    `);
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("reset role; truncate operation_batches,ai_scoped_requests,notes,tasks,courses,captures,calendar_events,external_calendar_accounts,integration_accounts,ai_preferences cascade; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  });

  it("computes canonical source identity/context and applies only exact persisted output", async () => {
    const id = await note(), other = await note("Unrelated");
    const r = await proposed(id);
    expect(JSON.parse(r.source_text)).toEqual({ title: "Selected note", body: "Original note" });
    expect(r.source_manifest).toEqual([{ kind: "note", id, fingerprint: await fingerprint("note", id) }]);
    const review = await read(r.batch);
    expect(review.input).toEqual(r.proposal);
    expect(review.provenance).toEqual({ provider: "ollama", model: "fixture", evidence: "browser_relay" });
    for (const extra of [{ rewrittenBody: "Substituted" }, { note_id: other }, { capability: items }, { source_manifest: [] }, { source_digest: "0".repeat(64) }]) {
      await expect(apply(r.batch, extra)).rejects.toThrow(/ai_invalid_shape/);
    }
    await apply(r.batch);
    expect((await db.query("select body from notes where id=$1", [id])).rows).toEqual([{ body: r.proposal.rewrittenBody }]);
    expect((await db.query("select body from notes where id=$1", [other])).rows).toEqual([{ body: "Unrelated" }]);
    expect((await read(r.batch)).status).toBe("committed");
    const audit = (await db.query<{ inverse: Record<string, unknown> }>("select inverse from operation_steps where batch_id=$1", [r.batch])).rows[0].inverse;
    expect(audit).toMatchObject({ review_digest: review.reviewDigest, source_manifest: r.source_manifest, provider: "ollama", model: "fixture", result: { entity: "note", ids: [id] }, undo_supported: false });
  });

  it("cannot use another capability's review even with a valid endpoint signature", async () => {
    const r = await proposed(await note());
    await expect(rpc("test_only.apply_items", `approve_scoped:${items}`, { batch_id: r.batch })).rejects.toThrow(/ai_capability_denied/);
    expect((await db.query("select * from tasks")).rows).toHaveLength(0);
  });

  it.each(["body", "title", "archived_at", "delete"])("rejects canonical Note %s changes after Prepare", async field => {
    const id = await note(), r = await proposed(id);
    if (field === "delete") await db.query("delete from notes where id=$1", [id]);
    else if (field === "archived_at") await db.query("update notes set archived_at=now() where id=$1", [id]);
    else await db.query(`update notes set ${field}='Manual change' where id=$1`, [id]);
    await expect(apply(r.batch)).rejects.toThrow(/ai_source_changed|ai_source_unavailable/);
    expect((await read(r.batch)).status).toBe("proposed");
  });

  it("also rejects stale sources before finalization or successor persistence", async () => {
    const id = await note(), r = await prepare(id);
    await db.query("update notes set body='Changed' where id=$1", [id]);
    await expect(rpc("ai_record_scoped_proposal", "record_scoped_proposal", { request_id: r.request, proposal: output(r.source_handle) })).rejects.toThrow(/ai_source_changed/);
    const fresh = await proposed(id);
    await db.query("update notes set body='Changed again' where id=$1", [id]);
    await expect(rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: fresh.batch, proposal: fresh.proposal })).rejects.toThrow(/ai_source_changed/);
  });

  it("persists exact edited successors, binds predecessor, preserves provenance, and invalidates A", async () => {
    const id = await note(), r = await proposed(id), original = await read(r.batch);
    const proposal = { ...r.proposal, rewrittenTitle: "Edited title", rewrittenBody: "  EXACT user edits\n" };
    const next = await rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: r.batch, proposal });
    const successor = await read(next);
    expect(successor.input).toEqual(proposal);
    expect(successor.reviewDigest).not.toBe(original.reviewDigest);
    expect(successor.predecessorBatchId).toBe(r.batch);
    expect(successor.provenance).toEqual(original.provenance);
    expect(successor.sourceManifest).toEqual(original.sourceManifest);
    expect((await read(r.batch)).input).toEqual(original.input);
    await expect(apply(r.batch)).rejects.toThrow(/ai_proposal_unavailable/);
    await expect(apply(next, { proposal: r.proposal })).rejects.toThrow(/ai_invalid_shape/);
    await apply(next);
    expect((await db.query("select title,body from notes where id=$1", [id])).rows).toEqual([{ title: proposal.rewrittenTitle, body: proposal.rewrittenBody }]);
  });

  it.each([
    { type: "delete_everything" }, { source_handle: "different" }, { note_id: owner },
    { rewrittenBody: 42 }, { rewrittenBody: "x".repeat(30001) }, { url: "https://example.invalid" },
    { rewrittenTitle: null }, { schema_version: "1" }, { rewrittenBody: "\u0007" },
  ])("rejects tampered successors without invalidating their predecessor %#", async patch => {
    const r = await proposed(await note());
    await expect(rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: r.batch, proposal: { ...r.proposal, ...patch } })).rejects.toThrow(/ai_invalid/);
    expect((await read(r.batch)).status).toBe("proposed");
    expect((await db.query("select id from operation_batches")).rows).toHaveLength(1);
  });

  it("rejects owner/source/fingerprint/provenance fields supplied to preparation or revision", async () => {
    const id = await note();
    const data = { capability: rewrite, selection: [{ kind: "note", id }], provider: "ollama", model: "fixture", time_zone: "Asia/Manila" };
    for (const extra of [{ user_id: foreign }, { source_digest: "0".repeat(64) }, { source_text: "Forged" }, { expires_at: "2099-01-01" }, { source_handle: "chosen" }]) {
      await expect(rpc("ai_create_scoped_request", "prepare_scoped_request", { ...data, ...extra })).rejects.toThrow(/ai_invalid_shape/);
    }
    await expect(rpc("ai_create_scoped_request", "prepare_scoped_request", { ...data, selection: [{ kind: "note", id, fingerprint: "forged" }] })).rejects.toThrow(/ai_invalid_shape/);
    await expect(rpc("ai_create_scoped_request", "prepare_scoped_request", { ...data, selection: [{ kind: "note", id }, { kind: "note", id }] })).rejects.toThrow(/ai_invalid_source/);
    await expect(rpc("ai_create_scoped_request", "prepare_scoped_request", { ...data, capability: "academicCalendarImport.propose" })).rejects.toThrow(/ai_capability_denied/);
    const r = await proposed(id);
    for (const extra of [{ source_id: randomUUID() }, { capability: items }, { provider: "gemini" }, { predecessor_batch_id: randomUUID() }]) {
      await expect(rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: r.batch, proposal: r.proposal, ...extra })).rejects.toThrow(/ai_invalid_shape/);
    }
  });

  it("rejects foreign sources/reviews and forged HMACs", async () => {
    const id = await note(), r = await proposed(id);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [foreign]);
    await expect(prepare(id)).rejects.toThrow(/ai_authorization_denied/);
    await expect(rpc("ai_create_scoped_request", "prepare_scoped_request", { capability: rewrite, selection: [{ kind: "note", id }], provider: "ollama", model: "fixture", time_zone: "Asia/Manila" }, foreign)).rejects.toThrow(/ai_source_unavailable/);
    await expect(rpc("test_only.apply_note", `approve_scoped:${rewrite}`, { batch_id: r.batch }, foreign)).rejects.toThrow(/ai_untrusted_proposal/);
    await expect(rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: r.batch, proposal: r.proposal }, foreign)).rejects.toThrow(/ai_proposal_unavailable/);
    expect(await read(r.batch)).toBeNull();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const [message] = proof(`approve_scoped:${rewrite}`, { batch_id: r.batch });
    await expect(db.query("select test_only.apply_note($1,$2)", [message, "0".repeat(64)])).rejects.toThrow(/ai_authorization_denied/);
  });

  it("rejects a correctly sealed but expired review", async () => {
    const r = await proposed(await note());
    // Construct expired evidence before insertion, not by disabling immutable
    // guards or letting a browser choose expiry. Only test fixture SQL can do it.
    await db.exec("reset role");
    const expired = (await db.query<{ id: string }>(`
      with old as (select * from ai_scoped_requests where id=$1),
      copy as (select jsonb_populate_record(null::public.ai_scoped_requests,
        to_jsonb(old)||jsonb_build_object('id',gen_random_uuid(),'created_at',now()-interval '6 minutes','expires_at',now()-interval '1 minute')) r from old),
      sealed as (select jsonb_populate_record(null::public.ai_scoped_requests,to_jsonb(r)||jsonb_build_object('authority_digest',ai_private.scoped_request_digest(r))) r from copy)
      insert into ai_scoped_requests select (r).* from sealed returning id
    `, [r.request])).rows[0].id;
    const batch = (await db.query<{ id: string }>("select ai_private.insert_scoped_review(r,$2::jsonb,null) id from ai_scoped_requests r where id=$1", [expired, r.proposal])).rows[0].id;
    await db.exec("set role authenticated");
    await expect(apply(batch)).rejects.toThrow(/ai_request_unavailable/);
  });

  it("consumes once under replay and queued simultaneous requests", async () => {
    const r = await proposed(await note(), items);
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => rpc("test_only.apply_items", `approve_scoped:${items}`, { batch_id: r.batch })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.query("select title from tasks")).rows).toEqual([{ title: "Reviewed task" }]);
    await expect(rpc("test_only.apply_items", `approve_scoped:${items}`, { batch_id: r.batch })).rejects.toThrow(/ai_request_unavailable/);
    // PGlite serializes queries; row locks/transaction constraints are exercised,
    // but this is not advertised as a live multi-connection PostgreSQL race.
  });

  it.each(["suggest_only", "trusted_automation"])("%s blocks mutation independent of provider/cloud settings", async mode => {
    const r = await proposed(await note());
    await db.query("insert into ai_preferences(user_id,permission_mode,cloud_enabled,notes_cloud) values($1,$2,true,true)", [owner, mode]);
    await expect(apply(r.batch)).rejects.toThrow(/ai_permission_denied/);
    expect((await read(r.batch)).status).toBe("proposed");
  });

  it("denies direct authenticated trusted source/review/step DML", async () => {
    const r = await proposed(await note());
    await expect(db.query("update ai_scoped_requests set source_text='Forged' where id=$1", [r.request])).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from ai_scoped_requests where id=$1", [r.request])).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into ai_scoped_requests(id,user_id) values($1,$2)", [randomUUID(), owner])).rejects.toThrow(/permission denied/);
    expect((await db.query("update operation_steps set input='{}' where batch_id=$1 returning id", [r.batch])).rows).toEqual([]);
    expect((await db.query("update operation_batches set status='committed' where id=$1 returning id", [r.batch])).rows).toEqual([]);
    expect((await db.query("delete from operation_steps where batch_id=$1 returning id", [r.batch])).rows).toEqual([]);
    await expect(db.query("insert into operation_batches(user_id,source,summary,ai_scoped_request_id) values($1,'user','Forged',$2)", [owner, r.request])).rejects.toThrow(/ai_untrusted_proposal|row-level security/);
    await expect(db.query("select ai_private.begin_scoped_apply('','', 'noteRewrite.propose')")).rejects.toThrow(/permission denied/);
  });

  it("keeps protected authority immutable even through privileged update mistakes", async () => {
    const r = await proposed(await note());
    await db.exec("reset role");
    await expect(db.query("update ai_scoped_requests set source_manifest='[]' where id=$1", [r.request])).rejects.toThrow(/ai_immutable_source/);
    await expect(db.query("update operation_steps set input='{}' where batch_id=$1", [r.batch])).rejects.toThrow(/ai_immutable_review/);
    await expect(db.query("update operation_batches set ai_review_digest=$2 where id=$1", [r.batch, "0".repeat(64)])).rejects.toThrow(/ai_immutable_review/);
    await db.exec("set role authenticated");
    await apply(r.batch);
    await db.exec("reset role");
    await expect(db.query("update ai_scoped_requests set status='proposed' where id=$1", [r.request])).rejects.toThrow(/ai_invalid_transition/);
    await expect(db.query("update operation_batches set status='proposed' where id=$1", [r.batch])).rejects.toThrow(/ai_invalid_transition|invalid operation/);
  });

  it.each(["domain", "audit", "unfinished"])("%s failure rolls back mutation, consumption and audit", async failure => {
    const id = await note(), r = await proposed(id);
    if (failure !== "unfinished") {
      await db.exec("reset role");
      await db.exec(failure === "domain" ? "alter table notes add constraint test_failure check (body='Original note')" : "alter table operation_steps add constraint test_failure check (inverse is null)");
      await db.exec("set role authenticated");
    }
    try {
      const pending = failure === "unfinished" ? rpc("test_only.unfinished", `approve_scoped:${rewrite}`, { batch_id: r.batch }) : apply(r.batch);
      await expect(pending).rejects.toThrow(/test_failure|ai_incomplete_consumption/);
      expect((await db.query("select body from notes where id=$1", [id])).rows).toEqual([{ body: "Original note" }]);
      expect((await read(r.batch)).status).toBe("proposed");
      expect((await db.query("select inverse from operation_steps where batch_id=$1", [r.batch])).rows).toEqual([{ inverse: null }]);
    } finally {
      if (failure !== "unfinished") { await db.exec(`reset role; alter table ${failure === "domain" ? "notes" : "operation_steps"} drop constraint test_failure; set role authenticated;`); }
    }
    await apply(r.batch);
  });

  it("rejects a standalone finish with no transaction-bound validated claim", async () => {
    const r = await proposed(await note());
    await db.exec("reset role");
    await expect(db.query("select ai_private.finish_scoped_apply($1,$2)", [r.batch, { entity: "note", ids: [] }])).rejects.toThrow(/ai_consumption_unavailable/);
  });

  it("fingerprints Course meeting inserts, edits, deletes and reparenting", async () => {
    const course = (await db.query<{ id: string }>("insert into courses(code,name) values('CS1','Course') returning id")).rows[0].id;
    const base = await fingerprint("course_meetings", course);
    const meeting = (await db.query<{ id: string }>("insert into course_meetings(course_id,title,weekdays,start_date,start_time,end_time) values($1,'Lecture',array[1,3],'2026-09-01','09:00','10:00') returning id", [course])).rows[0].id;
    const added = await fingerprint("course_meetings", course);
    expect(added).not.toBe(base);
    await db.query("update course_meetings set weekdays=array[3,1]::smallint[] where id=$1", [meeting]);
    expect(await fingerprint("course_meetings", course)).toBe(added);
    await db.query("update course_meetings set end_time='11:00' where id=$1", [meeting]);
    expect(await fingerprint("course_meetings", course)).not.toBe(added);
    const other = (await db.query<{ id: string }>("insert into courses(code,name) values('CS2','Other') returning id")).rows[0].id;
    await db.query("update course_meetings set course_id=$1 where id=$2", [other, meeting]);
    expect(await fingerprint("course_meetings", course)).toBe(base);
    const beforeDelete = await fingerprint("course_meetings", other);
    await db.query("delete from course_meetings where id=$1", [meeting]);
    expect(await fingerprint("course_meetings", other)).not.toBe(beforeDelete);
  });

  it("fingerprints immutable Capture identity and mutable lifecycle without browser snapshots", async () => {
    const id = (await db.query<{ id: string }>("insert into captures(kind,raw_content) values('text','{\"text\":\"Capture this\"}') returning id")).rows[0].id;
    const base = await fingerprint("capture", id);
    await db.query("update captures set stage='interpreted' where id=$1", [id]);
    expect(await fingerprint("capture", id)).not.toBe(base);
    await expect(fingerprint("capture", randomUUID())).rejects.toThrow(/ai_source_unavailable/);
    await expect(fingerprint("academic_source_title_hash", id)).rejects.toThrow(/ai_source_kind_denied/);
  });

  it("does not treat legacy academic title-hash rows as trusted import sources", async () => {
    const id = (await db.query<{ id: string }>("insert into calendar_events(title,starts_at,ends_at,source,external_id) values('Holiday','2026-09-01Z','2026-09-02Z','academic_calendar','title_hash') returning id")).rows[0].id;
    await expect(fingerprint("calendar_event", id)).rejects.toThrow(/ai_source_unavailable/);
  });

  it("TypeScript and SQL agree on accepted exact Note outputs", async () => {
    for (const capability of [rewrite, items]) {
      const r = await prepare(await note(), capability);
      const proposal = output(r.source_handle, capability);
      const parser = capability === rewrite ? parseNoteRewriteOutput : parseNoteActionItemsOutput;
      expect(parser(JSON.stringify(proposal), capability, r.source_handle)).toEqual(proposal);
      const batch = await rpc("ai_record_scoped_proposal", "record_scoped_proposal", { request_id: r.request, proposal });
      expect((await read(batch)).input).toEqual(proposal);
    }
  });

  it.each([
    [], Array.from({ length: 21 }, () => ({ title: "Too many" })),
    [{ title: 123 }], [{ title: "x".repeat(201) }], [{ title: "Task", dueDate: "2026-02-29" }],
    [{ title: "Task", dueDate: "2026-04-31" }], [{ title: "Task", dueDate: "2026-13-01" }],
    [{ title: "Task", dueDate: "2026-01-01T00:00:00Z" }], [{ title: "Task", dueDate: null }],
    [{ title: "Task", priority: "HIGH" }], [{ title: "Task", priority: 1 }],
    [{ title: "Task", id: owner }], [{ title: "Task", url: "https://example.invalid" }],
    [{ title: "Task", dueTime: "24:00" }], [null],
  ].map(actionItems => ({ actionItems })))("TypeScript and SQL both reject malformed action-item content %#", async ({ actionItems }) => {
    const r = await prepare(await note(), items);
    const proposal = { ...output(r.source_handle, items), actionItems };
    expect(() => parseNoteActionItemsOutput(JSON.stringify(proposal), items, r.source_handle)).toThrow();
    await expect(rpc("ai_record_scoped_proposal", "record_scoped_proposal", { request_id: r.request, proposal })).rejects.toThrow(/ai_invalid/);
    expect((await db.query("select * from operation_batches")).rows).toHaveLength(0);
  });

  it("fingerprints provider calendar identity and native target divergence independently", async () => {
    const account = (await db.query<{ id: string }>("insert into external_calendar_accounts(provider,display_name,status,encrypted_credential) values('google','Calendar','connected','test-only-not-a-secret') returning id")).rows[0].id;
    const calendar = (await db.query<{ id: string }>("insert into external_calendars(account_id,external_calendar_id,name) values($1,'provider-calendar','School') returning id", [account])).rows[0].id;
    const source = (await db.query<{ id: string }>("insert into external_calendar_events(calendar_id,external_event_id,revision,content_hash,title,starts_at,ends_at) values($1,'provider-event','r1','hash1','Holiday','2026-09-01Z','2026-09-02Z') returning id", [calendar])).rows[0].id;
    const target = (await db.query<{ id: string }>("insert into calendar_events(title,starts_at,ends_at,source) values('Holiday','2026-09-01Z','2026-09-02Z','life_os') returning id")).rows[0].id;
    const before = await fingerprint("external_calendar_event", source), nativeBefore = await fingerprint("calendar_event", target);
    await db.query("update external_calendar_events set starts_at='2026-09-03Z',ends_at='2026-09-04Z',revision='r2',content_hash='hash2' where id=$1", [source]);
    expect(await fingerprint("external_calendar_event", source)).not.toBe(before);
    await db.query("update calendar_events set description='Manual divergence' where id=$1", [target]);
    expect(await fingerprint("calendar_event", target)).not.toBe(nativeBefore);
    await db.exec("reset role");
    const refs = [{ kind: "calendar_event", id: target }, { kind: "external_calendar_event", id: source }];
    const manifest = (await db.query<{ m: unknown }>("select ai_private.scoped_source_manifest($1) m", [refs])).rows[0].m;
    expect((await db.query<{ m: unknown }>("select ai_private.scoped_source_manifest($1) m", [[...refs].reverse()])).rows[0].m).toEqual(manifest);
    await expect(db.query("select ai_private.scoped_source_manifest($1)", [[...refs, refs[0]]])).rejects.toThrow(/ai_invalid_source/);
    await db.exec("set role authenticated");
    await db.query("update external_calendar_accounts set status='disconnected' where id=$1", [account]);
    await expect(fingerprint("external_calendar_event", source)).rejects.toThrow(/ai_source_unavailable/);
  });

  it("fingerprints prediction state plus canonical material and Course dependencies without attesting legacy generation", async () => {
    const course = (await db.query<{ id: string }>("insert into courses(code,name) values('CS1','Course') returning id")).rows[0].id;
    const material = (await db.query<{ id: string }>("insert into course_materials(course_id,title,type,description) values($1,'Syllabus','syllabus','Original syllabus') returning id", [course])).rows[0].id;
    await db.exec("reset role");
    const prediction = (await db.query<{ id: string }>("insert into school_assessment_predictions(user_id,course_id,prediction_type,title,predicted_date,confidence,rationale,syllabus_material_id) values($1,$2,'exam','Possible exam','2026-09-10','MEDIUM','Unattested legacy row',$3) returning id", [owner, course, material])).rows[0].id;
    await db.exec("set role authenticated");
    const before = await fingerprint("prediction", prediction);
    await db.query("update course_materials set description='Revised syllabus' where id=$1", [material]);
    const materialChanged = await fingerprint("prediction", prediction);
    expect(materialChanged).not.toBe(before);
    await db.query("update courses set name='Renamed' where id=$1", [course]);
    expect(await fingerprint("prediction", prediction)).not.toBe(materialChanged);
    await expect(rpc("ai_create_scoped_request", "prepare_scoped_request", {
      capability: "schoolAssessmentPrediction.propose", selection: [{ kind: "prediction", id: prediction }], provider: "ollama", model: "fixture", time_zone: "Asia/Manila",
    })).rejects.toThrow(/ai_capability_denied/);
    await db.query("select dismiss_assessment_prediction($1)", [prediction]);
    await expect(fingerprint("prediction", prediction)).rejects.toThrow(/ai_source_unavailable/);
  });

  it("fingerprints stable Blackboard provider UID/revision and refuses fallback identities", async () => {
    const account = (await db.query<{ id: string }>("insert into integration_accounts(provider,encrypted_credential) values('blackboard','test-only-not-a-secret') returning id")).rows[0].id;
    const record = (await db.query<{ id: string }>("insert into external_records(account_id,provider,external_uid,normalized_title,content_hash) values($1,'blackboard','provider-uid','Exam','hash1') returning id", [account])).rows[0].id;
    const original = await fingerprint("blackboard_record", record);
    await db.query("update external_records set normalized_title='Changed exam',content_hash='hash2' where id=$1", [record]);
    expect(await fingerprint("blackboard_record", record)).not.toBe(original);
    const fallback = (await db.query<{ id: string }>("insert into external_records(account_id,provider,external_uid,normalized_title,content_hash) values($1,'blackboard','fallback:title-hash','Exam','hash1') returning id", [account])).rows[0].id;
    await expect(fingerprint("blackboard_record", fallback)).rejects.toThrow(/ai_source_unavailable/);
  });

  it("rejects incorrect predecessor owner/request relationships and direct step insertion", async () => {
    const r = await proposed(await note()), other = await proposed(await note());
    await expect(db.query("insert into operation_steps(user_id,batch_id,position,action_type,target_entity,input) values($1,$2,1,'forged','note','{}')", [owner, r.batch])).rejects.toThrow(/ai_invalid_proposal|row-level security/);
    await db.exec("reset role");
    await db.query("update operation_batches set status='rejected' where id=$1", [r.batch]);
    await expect(db.query("select ai_private.insert_scoped_review(r,$2,$3) from ai_scoped_requests r where id=$1", [other.request, other.proposal, r.batch])).rejects.toThrow(/ai_invalid_predecessor/);
    await expect(db.query("insert into operation_batches(user_id,source,summary,ai_scoped_request_id,ai_review_digest) values($1,'ai','Forged',$2,$3)", [foreign, other.request, "a".repeat(64)])).rejects.toThrow(/ai_owner_mismatch|ai_untrusted_proposal/);
  });

  it("preserves owner rejection and cannot revive or revise a rejected source", async () => {
    const r = await proposed(await note());
    await rpc("ai_reject_scoped_proposal", "reject_scoped_proposal", { batch_id: r.batch });
    expect((await read(r.batch)).status).toBe("rejected");
    await expect(apply(r.batch)).rejects.toThrow(/ai_request_unavailable/);
    await expect(rpc("ai_revise_scoped_proposal", "revise_scoped_proposal", { batch_id: r.batch, proposal: r.proposal })).rejects.toThrow(/ai_request_unavailable/);
  });

  it("canonical fingerprints and sealed reviews are independent of the database session timezone", async () => {
    const id = await note(), r = await proposed(id), before = await fingerprint("note", id);
    try {
      await db.exec("set timezone='America/New_York'");
      expect(await fingerprint("note", id)).toBe(before);
      await apply(r.batch);
    } finally { await db.exec("set timezone='UTC'"); }
  });
});
