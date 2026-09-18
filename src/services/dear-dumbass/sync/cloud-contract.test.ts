import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

describe("Dear Dumbass E2EE Sync Cloud Schema & RPC Contract", () => {
  let db: PGlite;

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

    // Load and execute all migrations in order
    const migrationFiles = readdirSync("supabase/migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }

    await db.query("insert into auth.users values($1),($2)", [userA, userB]);
  }, 60000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec(`
      reset role;
      delete from public.dear_dumbass_encrypted_records;
      delete from public.dear_dumbass_key_envelopes;
    `);
  });

  it("enforces RLS on dear_dumbass_key_envelopes: user isolation for envelopes", async () => {
    // Authenticate as User A
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);

    await db.query(
      `insert into public.dear_dumbass_key_envelopes
       (owner_id, salt, wrap_iv, encrypted_master_key)
       values ($1, 'saltA', 'ivA', 'encryptedKeyA')`,
      [userA],
    );

    const userARead = await db.query<{ encrypted_master_key: string }>(
      "select * from public.dear_dumbass_key_envelopes",
    );
    expect(userARead.rows).toHaveLength(1);
    expect(userARead.rows[0].encrypted_master_key).toBe("encryptedKeyA");

    // Authenticate as User B
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userB}';
    `);

    const userBRead = await db.query(
      "select * from public.dear_dumbass_key_envelopes",
    );
    expect(userBRead.rows).toHaveLength(0);

    // User B cannot update User A's envelope
    const userBUpdate = await db.query(
      `update public.dear_dumbass_key_envelopes
       set encrypted_master_key = 'hacked'
       where owner_id = $1`,
      [userA],
    );
    expect(userBUpdate.affectedRows).toBe(0);

    // Switch back to User A to verify no tampering
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);
    const recheckA = await db.query<{ encrypted_master_key: string }>(
      "select * from public.dear_dumbass_key_envelopes",
    );
    expect(recheckA.rows[0].encrypted_master_key).toBe("encryptedKeyA");
  });

  it("enforces RLS on dear_dumbass_encrypted_records: user isolation for records", async () => {
    // Authenticate as User A
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);

    await db.query(
      `insert into public.dear_dumbass_encrypted_records
       (owner_id, record_id, ciphertext, iv)
       values ($1, 'rec-1', 'ciphertextA', 'ivA')`,
      [userA],
    );

    const userARead = await db.query<{ ciphertext: string }>(
      "select * from public.dear_dumbass_encrypted_records",
    );
    expect(userARead.rows).toHaveLength(1);
    expect(userARead.rows[0].ciphertext).toBe("ciphertextA");

    // Authenticate as User B
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userB}';
    `);

    const userBRead = await db.query(
      "select * from public.dear_dumbass_encrypted_records",
    );
    expect(userBRead.rows).toHaveLength(0);

    // User B cannot delete User A's record
    const userBDelete = await db.query(
      "delete from public.dear_dumbass_encrypted_records where record_id = 'rec-1'",
    );
    expect(userBDelete.affectedRows).toBe(0);
  });

  it("blocks anonymous role from reading or writing cloud data", async () => {
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);
    await db.query(
      `insert into public.dear_dumbass_key_envelopes
       (owner_id, salt, wrap_iv, encrypted_master_key)
       values ($1, 'saltA', 'ivA', 'encryptedKeyA')`,
      [userA],
    );
    await db.query(
      `insert into public.dear_dumbass_encrypted_records
       (owner_id, record_id, ciphertext, iv)
       values ($1, 'rec-anon', 'cipherA', 'ivA')`,
      [userA],
    );

    // Switch to anon role - anon has no table access or returns permission denied
    await db.exec(`
      set role anon;
      reset "request.jwt.claim.sub";
    `);

    await expect(
      db.query("select * from public.dear_dumbass_key_envelopes"),
    ).rejects.toThrow("permission denied");

    await expect(
      db.query("select * from public.dear_dumbass_encrypted_records"),
    ).rejects.toThrow("permission denied");

    // RPC fails for unauthenticated
    await expect(
      db.query("select public.upsert_dear_dumbass_record('rec-anon', 0, 1, 'c', 'iv', 1)"),
    ).rejects.toThrow("Not authenticated");
  });

  it("upsert_dear_dumbass_record performs atomic CAS insert and updates", async () => {
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);

    // 1. New insert with expected_sync_version = 0 (or null)
    const insertRes = await db.query<{ result: { status: string; sync_version: number; server_change_sequence: number } }>(
      `select public.upsert_dear_dumbass_record(
        'rec-cas-1',
        0,
        1,
        'cipher_v1',
        'iv_v1',
        1
      ) as result`,
    );
    expect(insertRes.rows[0].result.status).toBe("ok");
    expect(insertRes.rows[0].result.sync_version).toBe(1);
    const firstSeq = insertRes.rows[0].result.server_change_sequence;
    expect(Number(firstSeq)).toBeGreaterThan(0);

    // 2. Valid CAS update with expected_sync_version = 1
    const updateRes = await db.query<{ result: { status: string; sync_version: number; server_change_sequence: number } }>(
      `select public.upsert_dear_dumbass_record(
        'rec-cas-1',
        1,
        1,
        'cipher_v2',
        'iv_v2',
        1
      ) as result`,
    );
    expect(updateRes.rows[0].result.status).toBe("ok");
    expect(updateRes.rows[0].result.sync_version).toBe(2);
    expect(Number(updateRes.rows[0].result.server_change_sequence)).toBeGreaterThan(Number(firstSeq));

    // 3. Stale CAS update with expected_sync_version = 1 (current is 2)
    const staleRes = await db.query<{ result: { status: string; current_sync_version: number; message: string } }>(
      `select public.upsert_dear_dumbass_record(
        'rec-cas-1',
        1,
        1,
        'cipher_stale',
        'iv_stale',
        1
      ) as result`,
    );
    expect(staleRes.rows[0].result.status).toBe("conflict");
    expect(staleRes.rows[0].result.current_sync_version).toBe(2);

    // Verify row in DB was not modified by the stale attempt
    const rowCheck = await db.query<{ ciphertext: string; sync_version: number }>(
      "select ciphertext, sync_version from public.dear_dumbass_encrypted_records where record_id = 'rec-cas-1'",
    );
    expect(rowCheck.rows[0].ciphertext).toBe("cipher_v2");
    expect(rowCheck.rows[0].sync_version).toBe(2);
  });

  it("advances monotonic change sequence across updates and supports incremental cursor pull", async () => {
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);

    // Insert 3 records
    const r1 = await db.query<{ result: { server_change_sequence: number } }>(
      `select public.upsert_dear_dumbass_record('p1', 0, 1, 'c1', 'iv1', 1) as result`,
    );
    const r2 = await db.query<{ result: { server_change_sequence: number } }>(
      `select public.upsert_dear_dumbass_record('p2', 0, 1, 'c2', 'iv2', 1) as result`,
    );
    const r3 = await db.query<{ result: { server_change_sequence: number } }>(
      `select public.upsert_dear_dumbass_record('p3', 0, 1, 'c3', 'iv3', 1) as result`,
    );

    const s1 = Number(r1.rows[0].result.server_change_sequence);
    const s2 = Number(r2.rows[0].result.server_change_sequence);
    const s3 = Number(r3.rows[0].result.server_change_sequence);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);

    // Initial pull cursor from 0 returns all 3
    const pullAll = await db.query(
      `select record_id, server_change_sequence from public.dear_dumbass_encrypted_records
       where server_change_sequence > 0
       order by server_change_sequence asc`,
    );
    expect(pullAll.rows).toHaveLength(3);

    // Update p1: its server_change_sequence advances beyond s3
    const updateP1 = await db.query<{ result: { server_change_sequence: number } }>(
      `select public.upsert_dear_dumbass_record('p1', 1, 1, 'c1_updated', 'iv1_new', 1) as result`,
    );
    const s1Updated = Number(updateP1.rows[0].result.server_change_sequence);
    expect(s1Updated).toBeGreaterThan(s3);

    // Incremental pull after s3 should return only the updated p1
    const pullIncremental = await db.query<{ record_id: string }>(
      `select record_id, server_change_sequence from public.dear_dumbass_encrypted_records
       where server_change_sequence > $1
       order by server_change_sequence asc`,
      [s3],
    );
    expect(pullIncremental.rows).toHaveLength(1);
    expect(pullIncremental.rows[0].record_id).toBe("p1");
  });

  it("upsert_dear_dumbass_record isolates records between users", async () => {
    // User A inserts rec-1
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);
    await db.query(
      `select public.upsert_dear_dumbass_record('rec-1', 0, 1, 'cipherA', 'ivA', 1)`,
    );

    // User B inserts rec-1 in their own workspace
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userB}';
    `);
    const userBInsert = await db.query<{ result: { status: string; sync_version: number } }>(
      `select public.upsert_dear_dumbass_record('rec-1', 0, 1, 'cipherB', 'ivB', 1) as result`,
    );
    expect(userBInsert.rows[0].result.status).toBe("ok");
    expect(userBInsert.rows[0].result.sync_version).toBe(1);

    // User A's record remains unaffected
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userA}';
    `);
    const userARead = await db.query<{ ciphertext: string }>(
      "select ciphertext from public.dear_dumbass_encrypted_records where record_id = 'rec-1'",
    );
    expect(userARead.rows[0].ciphertext).toBe("cipherA");
  });
});
