import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222", key=Buffer.alloc(32,19); let db:PGlite;
type ReviewEvent={entryId:string;reviewed:unknown;operation:string;baseline?:unknown;current?:unknown};
type Review={input:{events:ReviewEvent[];skipped:unknown[]}};
function proof(operation:string,data:Record<string,unknown>){const message=JSON.stringify({version:1,user_id:owner,operation,expires:Math.floor(Date.now()/1000)+60,data});return[message,createHmac("sha256",key).update(message).digest("hex")]}
async function rpc(name:string,operation:string,data:Record<string,unknown>){return(await db.query<{v:unknown}>(`select public.${name}($1,$2) v`,proof(operation,data))).rows[0]?.v}
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const event=(title:string,start="2026-09-01T00:00:00.000Z",description:string|null=null)=>({title,description,start,end:new Date(Date.parse(start)+86400000).toISOString(),allDay:true,eventType:"event"});
const entry=(id:string,value=event("Holiday"))=>({identityKind:"ics_uid",identityKey:`ics:${digest(id)}`,structureKey:"ics-line:4",identityEvidence:id,event:value});
async function prepare(text:string,sourceId:string|null=null,label="University Calendar"){
  return rpc("ai_prepare_academic_calendar","prepare_academic_calendar",{source_id:sourceId,label,format:"ics",content_digest:digest(text),normalized_text:text,image_id:null,disclosure_id:null,
    provider:"server_parser",model:"deterministic-v2",location:"server",file_name:"calendar.ics",time_zone:"Asia/Manila",provenance:{version:1,parser:"bounded_deterministic_v2"}}) as Promise<{requestId:string;sourceId:string;revisionId:string}>;
}
async function proposal(text:string,entries:unknown[],sourceId:string|null=null,label?:string){const p=await prepare(text,sourceId,label);const batch=await rpc("ai_record_academic_calendar","record_academic_calendar",{request_id:p.requestId,entries}) as string;return{...p,batch}}
async function review(batch:string){return (await db.query<{v:Review}>("select public.ai_read_scoped_review($1) v",[batch])).rows[0].v}
async function revise(batch:string,decisions:("APPLY"|"APPLY_SOURCE"|"KEEP_CURRENT"|"IGNORE")[]){const r=await review(batch);return rpc("ai_revise_academic_calendar","revise_academic_calendar",{batch_id:batch,edits:r.input.events.map((x,i)=>({entryId:x.entryId,decision:decisions[i],event:x.reviewed}))}) as Promise<string>}
async function apply(batch:string){return rpc("ai_apply_academic_calendar","approve_scoped:academicCalendarImport.propose",{batch_id:batch})}

describe("Pass 2B trusted Academic Calendar import",()=>{
  beforeAll(async()=>{db=new PGlite({extensions:{pgcrypto}});await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;alter default privileges in schema public grant all on tables to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid,name text,bucket_id text);`);for(const file of readdirSync("supabase/migrations").filter(x=>x.endsWith(".sql")).sort())await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));await db.exec("grant all on all tables in schema public to service_role");await db.query("insert into ai_private.signing_key(secret) values($1)",[key]);await db.query("insert into auth.users(id) values($1),($2)",[owner,other]);},60_000);
  afterAll(async()=>db?.close());
  beforeEach(async()=>{await db.exec("reset role;truncate academic_calendar_entry_links,academic_calendar_revision_entries,academic_calendar_source_entries,academic_calendar_import_sources,ai_inference_attempts,operation_batches,ai_scoped_requests,ai_image_disclosures,ai_validated_images,ai_preferences,calendar_events cascade;set role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);});

  it("preserves same-title, same-date and cross-source entries and makes unchanged reimport inert",async()=>{
    const first=await proposal("revision-a",[entry("uid-a"),entry("uid-b")]);const successor=await revise(first.batch,["APPLY","APPLY"]);await apply(successor);
    const second=await proposal("other-source",[entry("uid-a")],null,"Other University");await apply(await revise(second.batch,["APPLY"]));
    expect((await db.query("select id from calendar_events")).rows).toHaveLength(3);
    const unchanged=await proposal("revision-a",[entry("uid-a"),entry("uid-b")],first.sourceId);const unchangedReview=await review(unchanged.batch);
    expect(unchangedReview.input.events.map((x)=>x.operation)).toEqual(["UNCHANGED","UNCHANGED"]);
    await apply(await revise(unchanged.batch,["IGNORE","IGNORE"]));expect((await db.query("select id from calendar_events")).rows).toHaveLength(3);
  });

  it("updates same-entry title/date only from a fresh successor and advances its baseline",async()=>{
    const first=await proposal("v1",[entry("stable",event("Old"))]);await apply(await revise(first.batch,["APPLY"]));
    const changed=await proposal("v2",[entry("stable",event("New","2026-09-09T00:00:00.000Z"))],first.sourceId);const r=await review(changed.batch);
    expect(r.input.events[0].operation).toBe("UPDATE");const successor=await revise(changed.batch,["APPLY"]);
    await expect(apply(changed.batch)).rejects.toThrow(/proposal_unavailable/);await apply(successor);
    expect((await db.query("select title,starts_at::text from calendar_events")).rows[0]).toMatchObject({title:"New"});
    expect((await db.query<{last_imported:{title:string};baseline_digest:string}>("select last_imported,baseline_digest from academic_calendar_entry_links")).rows[0].last_imported.title).toBe("New");
  });

  it.each(["title","description","starts_at","ends_at","all_day","event_type"])("turns manual %s divergence into a reviewed conflict without overwrite",async(field)=>{
    const first=await proposal(`base-${field}`,[entry("stable",event("Original"))]);await apply(await revise(first.batch,["APPLY"]));
    const values:Record<string,unknown>={title:"Manual",description:"Manual",starts_at:"2026-09-01T12:00:00Z",ends_at:"2026-09-03T00:00:00Z",all_day:false,event_type:"school"};
    await db.query(`update calendar_events set ${field}=$1`,[values[field]]);
    const changed=await proposal(`next-${field}`,[entry("stable",event("Source change","2026-09-09T00:00:00.000Z"))],first.sourceId);const r=await review(changed.batch);
    expect(r.input.events[0]).toMatchObject({operation:"CONFLICT"});expect(r.input.events[0].baseline).not.toEqual(r.input.events[0].current);
    await apply(await revise(changed.batch,["KEEP_CURRENT"]));expect((await db.query<{v:unknown}>(`select ${field} v from calendar_events`)).rows[0].v).toBeDefined();
  });

  it("rejects canonical/source/baseline freshness changes, substitution, replay, concurrency and suggest_only",async()=>{
    const first=await proposal("fresh-v1",[entry("stable")]);let successor=await revise(first.batch,["APPLY"]);
    await expect(rpc("ai_apply_academic_calendar","approve_scoped:academicCalendarImport.propose",{batch_id:successor,canonical_event_id:randomUUID()})).rejects.toThrow(/invalid_shape/);
    const concurrent=await Promise.allSettled([apply(successor),apply(successor)]);expect(concurrent.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect((await db.query("select id from calendar_events")).rows).toHaveLength(1);
    await expect(apply(successor)).rejects.toThrow(/proposal_unavailable|request_unavailable/);
    const changed=await proposal("fresh-v2",[entry("stable",event("Changed"))],first.sourceId);successor=await revise(changed.batch,["APPLY"]);
    await db.query("update calendar_events set title='Manual after review'");await expect(apply(successor)).rejects.toThrow(/source_changed/);
    await db.query("insert into ai_preferences(user_id,permission_mode) values($1,'suggest_only') on conflict(user_id) do update set permission_mode='suggest_only'",[owner]);
    const denied=await proposal("denied",[entry("new")]);await expect(apply(await revise(denied.batch,["APPLY"]))).rejects.toThrow(/permission_denied/);
  });

  it("marks removed entries absent without deleting events and denies browser writes/cross-owner reads",async()=>{
    const first=await proposal("remove-v1",[entry("keep"),entry("remove")]);await apply(await revise(first.batch,["APPLY","APPLY"]));
    const next=await proposal("remove-v2",[entry("keep")],first.sourceId);const r=await review(next.batch);expect(r.input.skipped).toEqual(expect.arrayContaining([expect.objectContaining({reason:"removed"})]));
    await apply(await revise(next.batch,["IGNORE"]));expect((await db.query("select id from calendar_events")).rows).toHaveLength(2);expect((await db.query("select status from academic_calendar_source_entries order by status")).rows).toEqual([{status:"absent"},{status:"present"}]);
    await expect(db.query("insert into academic_calendar_import_sources(format,label) values('ics','Browser forged')")).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into calendar_events(title,starts_at,ends_at,source,external_id) values('Forged','2026-01-01Z','2026-01-02Z','academic_calendar','entry:forged')")).rejects.toThrow(/provenance_protected/);
    await expect(db.query("update calendar_events set external_id='entry:substituted' where source='academic_calendar'")).rejects.toThrow(/provenance_protected/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);expect((await db.query("select * from academic_calendar_import_sources")).rows).toHaveLength(0);
  });

  it("rolls back an earlier Calendar mutation when a later entry freshness check fails",async()=>{
    const first=await proposal("rollback-v1",[entry("a",event("A")),entry("b",event("B"))]);await apply(await revise(first.batch,["APPLY","APPLY"]));
    await db.exec("reset role;set role service_role");
    const links=(await db.query<{entry_id:string;canonical_event_id:string;last_imported:unknown;baseline_digest:string}>("select entry_id,canonical_event_id,last_imported,baseline_digest from academic_calendar_entry_links order by entry_id")).rows;
    await db.query("update academic_calendar_entry_links set canonical_event_id=$1,last_imported=$2,baseline_digest=$3 where entry_id=$4",[links[0].canonical_event_id,links[0].last_imported,links[0].baseline_digest,links[1].entry_id]);
    await db.exec("set role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const next=await proposal("rollback-v2",[entry("a",event("A2")),entry("b",event("B2"))],first.sourceId);const r=await review(next.batch);
    expect(r.input.events.every((x)=>x.operation==="UPDATE")).toBe(true);const successor=await revise(next.batch,["APPLY","APPLY"]);
    await expect(apply(successor)).rejects.toThrow(/source_changed/);
    expect((await db.query("select title from calendar_events order by title")).rows).toEqual([{title:"A"},{title:"B"}]);
  });

  it("rejects source-revision, source-entry and baseline changes made after review",async()=>{
    const sourceCase=await proposal("source-base",[entry("source")]);await apply(await revise(sourceCase.batch,["APPLY"]));
    const sourceUpdate=await proposal("source-update",[entry("source",event("Source update"))],sourceCase.sourceId);const sourceSuccessor=await revise(sourceUpdate.batch,["APPLY"]);
    await prepare("newer-unreviewed-revision",sourceCase.sourceId);await expect(apply(sourceSuccessor)).rejects.toThrow(/source_changed|source_unavailable/);

    const entryCase=await proposal("entry-base",[entry("entry")]);await apply(await revise(entryCase.batch,["APPLY"]));
    const entryUpdate=await proposal("entry-update",[entry("entry",event("Entry update"))],entryCase.sourceId);const entrySuccessor=await revise(entryUpdate.batch,["APPLY"]);
    await db.exec("reset role;set role service_role");await db.query("update academic_calendar_source_entries set status='absent' where source_id=$1",[entryCase.sourceId]);
    await db.exec("set role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await expect(apply(entrySuccessor)).rejects.toThrow(/source_changed/);

    const baselineCase=await proposal("baseline-base",[entry("baseline")]);await apply(await revise(baselineCase.batch,["APPLY"]));
    const baselineUpdate=await proposal("baseline-update",[entry("baseline",event("Baseline update"))],baselineCase.sourceId);const baselineSuccessor=await revise(baselineUpdate.batch,["APPLY"]);
    await db.exec("reset role;set role service_role");await db.query("update academic_calendar_entry_links set baseline_digest=$1 where entry_id in(select id from academic_calendar_source_entries where source_id=$2)",["0".repeat(64),baselineCase.sourceId]);
    await db.exec("set role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await expect(apply(baselineSuccessor)).rejects.toThrow(/source_changed/);
  });
});
