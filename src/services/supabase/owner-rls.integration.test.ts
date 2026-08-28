import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_RLS_TEST_URL;
const publishableKey = process.env.SUPABASE_RLS_TEST_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_RLS_TEST_SERVICE_ROLE_KEY;
const configured = Boolean(url && publishableKey && serviceRoleKey);
const integrationDescribe = configured ? describe.sequential : describe.skip;

integrationDescribe("owner RLS against configured Supabase", () => {
  let admin: SupabaseClient;
  let userA: SupabaseClient;
  let userB: SupabaseClient;
  let anonymous: SupabaseClient;
  let userAId = "";
  let userBId = "";

  beforeAll(async () => {
    const runId = randomUUID();
    const password = `Rls-${randomUUID()}!aA1`;
    admin = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const a = await admin.auth.admin.createUser({
      email: `life-os-rls-a-${runId}@example.com`,
      password,
      email_confirm: true,
    });
    const b = await admin.auth.admin.createUser({
      email: `life-os-rls-b-${runId}@example.com`,
      password,
      email_confirm: true,
    });
    if (a.error || !a.data.user || b.error || !b.data.user) {
      throw new Error("Could not create isolated RLS test identities.");
    }

    userAId = a.data.user.id;
    userBId = b.data.user.id;
    userA = createClient(url!, publishableKey!, { auth: { persistSession: false } });
    userB = createClient(url!, publishableKey!, { auth: { persistSession: false } });
    anonymous = createClient(url!, publishableKey!, { auth: { persistSession: false } });

    const [aSignIn, bSignIn] = await Promise.all([
      userA.auth.signInWithPassword({ email: a.data.user.email!, password }),
      userB.auth.signInWithPassword({ email: b.data.user.email!, password }),
    ]);
    if (aSignIn.error || bSignIn.error) throw new Error("Could not authenticate RLS test identities.");
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    if (userAId || userBId) {
      const ids = [userAId, userBId].filter(Boolean);
      await admin.from("tasks").delete().in("user_id", ids);
      await admin.from("calendar_events").delete().in("user_id", ids);
    }
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }, 30_000);

  async function verifyTable(
    table: "tasks" | "calendar_events",
    ownedRow: Record<string, unknown>,
    update: Record<string, unknown>,
  ) {
    const inserted = await userA
      .from(table)
      .insert({ ...ownedRow, user_id: userAId })
      .select("id, user_id")
      .single();
    expect(inserted.error).toBeNull();
    const id = inserted.data!.id as string;

    const ownerRead = await userA.from(table).select("id").eq("id", id);
    expect(ownerRead.data).toHaveLength(1);

    const otherRead = await userB.from(table).select("id").eq("id", id);
    expect(otherRead.error).toBeNull();
    expect(otherRead.data).toEqual([]);

    const anonymousRead = await anonymous.from(table).select("id").eq("id", id);
    expect(anonymousRead.error).toBeNull();
    expect(anonymousRead.data).toEqual([]);

    const otherUpdate = await userB.from(table).update(update).eq("id", id).select("id");
    expect(otherUpdate.error).toBeNull();
    expect(otherUpdate.data).toEqual([]);

    const otherDelete = await userB.from(table).delete().eq("id", id).select("id");
    expect(otherDelete.error).toBeNull();
    expect(otherDelete.data).toEqual([]);

    const forgedInsert = await userA.from(table).insert({ ...ownedRow, user_id: userBId });
    expect(forgedInsert.error).not.toBeNull();

    const ownerUpdate = await userA.from(table).update(update).eq("id", id).select("id").single();
    expect(ownerUpdate.error).toBeNull();

    const ownerDelete = await userA.from(table).delete().eq("id", id).select("id").single();
    expect(ownerDelete.error).toBeNull();
  }

  it("enforces ownership for tasks", async () => {
    await verifyTable("tasks", { title: "RLS task" }, { title: "RLS task updated" });
  });

  it("enforces ownership for native calendar events", async () => {
    await verifyTable(
      "calendar_events",
      {
        title: "RLS event",
        starts_at: "2030-01-01T09:00:00.000Z",
        ends_at: "2030-01-01T10:00:00.000Z",
        source: "life_os",
      },
      { title: "RLS event updated" },
    );
  });
});
