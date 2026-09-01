import { createHash, createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const key = Buffer.alloc(32, 11);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const digest = createHash("sha256").update(png).digest("hex");
let db: PGlite;

function proof(operation: string, data: Record<string, unknown>, user = owner) {
  const message = JSON.stringify({ version: 1, user_id: user, operation, expires: Math.floor(Date.now() / 1000) + 60, data });
  return [message, createHmac("sha256", key).update(message).digest("hex")];
}
async function rpc(name: string, operation: string, data: Record<string, unknown>, user = owner) {
  return (await db.query<{ value: unknown }>(`select public.${name}($1,$2) value`, proof(operation, data, user))).rows[0]?.value;
}
async function asUser(user: string) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function saveModel(provider: string, model: string, supportsImage: boolean, user = owner) {
  return rpc("ai_save_local_model_configuration", "save_local_model_configuration", {
    provider, model, supports_image: supportsImage,
  }, user) as Promise<string>;
}
async function source(capability = "schoolScheduleImage.propose", user = owner) {
  return rpc("ai_create_validated_image", "create_validated_image", {
    capability,
    normalized_base64: png.toString("base64"),
    normalized_digest: digest,
    normalized_byte_count: png.length,
    width: 1,
    height: 1,
  }, user) as Promise<string>;
}
async function prepare(imageId: string, capability = "schoolScheduleImage.propose", user = owner) {
  return rpc("ai_prepare_image_disclosure", "prepare_image_disclosure", {
    image_id: imageId,
    capability,
    provider: "ollama",
    model: "vision-fixture",
    location: "local",
    modality_source: "saved_local_configuration",
  }, user) as Promise<string>;
}

describe("Pass 2A normalized-image authority", () => {
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
    for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
    await db.exec("grant all on all tables in schema public to service_role");
    await db.query("insert into ai_private.signing_key(secret) values($1)", [key]);
    await db.query("insert into auth.users(id) values($1),($2)", [owner, foreign]);
  }, 60_000);

  afterAll(async () => db?.close());

  beforeEach(async () => {
    await db.exec("reset role; truncate ai_image_disclosures, ai_validated_images, ai_model_configurations, ai_preferences cascade");
    await asUser(owner);
  });

  it("fails closed for unknown/text modality and persists only exact signed local configuration", async () => {
    const imageId = await source();
    await expect(prepare(imageId)).rejects.toThrow(/unsupported_modality/);
    await saveModel("ollama", "vision-fixture", false);
    await expect(prepare(imageId)).rejects.toThrow(/unsupported_modality/);
    await expect(saveModel("llamacpp", "vision-fixture", true)).rejects.toThrow(/ai_invalid_model_configuration/);

    await saveModel("ollama", "vision-fixture", true);
    expect(await prepare(imageId)).toMatch(/^[0-9a-f-]{36}$/);
    await expect(db.query("insert into ai_model_configurations(provider,model) values('ollama','browser-write')")).rejects.toThrow(/permission denied/);
  });

  it("binds exact bytes, capability, model route and disclosure fields", async () => {
    await saveModel("ollama", "vision-fixture", true);
    const imageId = await source();
    await expect(prepare(imageId, "blackboardCourseImage.propose")).rejects.toThrow(/ai_image_unavailable/);
    const disclosureId = await prepare(imageId);

    await expect(rpc("ai_claim_image_disclosure", "claim_image_disclosure", {
      disclosure_id: disclosureId,
      normalized_base64: Buffer.from("substitute").toString("base64"),
    })).rejects.toThrow(/ai_invalid_shape/);
    const claimed = await rpc("ai_claim_image_disclosure", "claim_image_disclosure", { disclosure_id: disclosureId }) as Record<string, unknown>;
    expect(claimed).toMatchObject({
      disclosureId,
      capability: "schoolScheduleImage.propose",
      provider: "ollama",
      model: "vision-fixture",
      location: "local",
      mimeType: "image/png",
      base64: png.toString("base64"),
      digest,
      byteCount: png.length,
      disclosureFields: ["normalized_image"],
    });
    await expect(rpc("ai_claim_image_disclosure", "claim_image_disclosure", { disclosure_id: disclosureId })).rejects.toThrow(/ai_disclosure_unavailable|unsupported_modality/);
  });

  it("rejects expired, revoked, malformed and cross-owner sources and wipes retained bytes", async () => {
    await saveModel("ollama", "vision-fixture", true);
    const expired = await source();
    await db.exec("reset role; set role service_role");
    await db.query("update ai_validated_images set expires_at=now()-interval '1 second' where id=$1", [expired]);
    await asUser(owner);
    await expect(prepare(expired)).rejects.toThrow(/ai_image_unavailable/);
    expect(await db.query("select ai_purge_my_expired_images() value")).toMatchObject({ rows: [{ value: 1 }] });
    await db.exec("reset role; set role service_role");
    expect((await db.query<{ normalized_bytes: Uint8Array | null }>("select normalized_bytes from ai_validated_images where id=$1", [expired])).rows[0].normalized_bytes).toBeNull();

    await asUser(owner);
    const revoked = await source();
    await rpc("ai_revoke_validated_image", "revoke_validated_image", { image_id: revoked });
    await expect(prepare(revoked)).rejects.toThrow(/ai_image_unavailable/);
    await expect(rpc("ai_create_validated_image", "create_validated_image", {
      capability: "schoolScheduleImage.propose", normalized_base64: "aHR0cHM6Ly9hdHRhY2tlci8=", normalized_digest: "0".repeat(64),
      normalized_byte_count: 17, width: 1, height: 1,
    })).rejects.toThrow(/ai_invalid_image/);

    await asUser(foreign);
    await saveModel("ollama", "vision-fixture", true, foreign);
    await expect(prepare(revoked, "schoolScheduleImage.propose", foreign)).rejects.toThrow(/ai_image_unavailable/);
  });

  it("requires separate cloud privacy permission and an explicit consent claim", async () => {
    await db.query(`insert into ai_preferences(user_id,cloud_enabled,cloud_fallback_mode,school_schedule_cloud,blackboard_course_cloud,academic_calendar_cloud)
      values($1,true,'ask_each_time',true,false,false)`, [owner]);
    const schedule = await source();
    const disclosureId = await rpc("ai_prepare_image_disclosure", "prepare_image_disclosure", {
      image_id: schedule, capability: "schoolScheduleImage.propose", provider: "gemini", model: "gemini-vision-fixture",
      location: "cloud", modality_source: "server_cloud_configuration",
    }) as string;
    await expect(rpc("ai_claim_image_disclosure", "claim_image_disclosure", { disclosure_id: disclosureId })).rejects.toThrow(/ai_cloud_privacy_denied/);
    await rpc("ai_consent_image_disclosure", "consent_image_disclosure", { disclosure_id: disclosureId });
    expect(await rpc("ai_claim_image_disclosure", "claim_image_disclosure", { disclosure_id: disclosureId })).toMatchObject({ digest });

    const blackboard = await source("blackboardCourseImage.propose");
    await expect(rpc("ai_prepare_image_disclosure", "prepare_image_disclosure", {
      image_id: blackboard, capability: "blackboardCourseImage.propose", provider: "gemini", model: "gemini-vision-fixture",
      location: "cloud", modality_source: "server_cloud_configuration",
    })).rejects.toThrow(/ai_cloud_privacy_denied/);
  });

  it("exposes no browser table path to normalized bytes or disclosures", async () => {
    for (const table of ["ai_validated_images", "ai_image_disclosures"]) {
      await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into ${table} default values`)).rejects.toThrow(/permission denied/);
    }
    const grants = (await db.query<{ table_name: string; privilege_type: string }>(`
      select table_name,privilege_type from information_schema.role_table_grants
      where grantee='authenticated' and table_name in ('ai_validated_images','ai_image_disclosures')`)).rows;
    expect(grants).toEqual([]);
  });
});
