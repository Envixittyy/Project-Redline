import "server-only";

import { randomUUID } from "node:crypto";

import { notificationDedupeKey } from "@/services/notifications/notification-domain";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

import { credentialHint, decryptCredential, encryptCredential } from "./credential";
import { parseBlackboardICalendar } from "./ical";
import { fetchBlackboardCalendar } from "./safe-fetch";
import { validateFeedUrl } from "./safe-url";
import { planBlackboardSync, type ExistingBlackboardRecord } from "./sync-domain";

type BlackboardAccountRow = {
  id: string;
  status: string;
  credential_hint: string | null;
  sync_state: string;
  last_success_at: string | null;
  last_error_code: string | null;
};

type SyncRunRow = {
  id: string;
  status: string;
  started_at: string;
  created_count: number;
  updated_count: number;
  missing_count: number;
  error_code: string | null;
};

type SyncChangeRow = {
  id: string;
  change_type: string;
  summary: string;
  created_at: string;
};

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  deep_link: string;
  created_at: string;
};

type ExternalRecordRow = {
  id: string;
  external_uid: string;
  content_hash: string;
  task_id: string | null;
  due_at: string | null;
  missing_since: string | null;
};

type AuthenticatedClient = Awaited<
  ReturnType<typeof requireAuthenticatedSupabase>
>["client"];

export type BlackboardStatus = {
  connected: boolean;
  credentialHint: string | null;
  syncState: string;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    created: number;
    updated: number;
    missing: number;
    errorCode: string | null;
  }>;
  changes: Array<{ id: string; type: string; summary: string; createdAt: string }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    deepLink: string;
    createdAt: string;
  }>;
};

export async function getBlackboardStatus(): Promise<BlackboardStatus> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const account = await client
    .from("integration_accounts")
    .select("id,status,credential_hint,sync_state,last_success_at,last_error_code")
    .eq("user_id", userId)
    .eq("provider", "blackboard")
    .maybeSingle();

  if (account.error) throw account.error;
  if (!account.data) {
    return {
      connected: false,
      credentialHint: null,
      syncState: "idle",
      lastSuccessAt: null,
      lastErrorCode: null,
      runs: [],
      changes: [],
      notifications: [],
    };
  }

  const accountRow = account.data as BlackboardAccountRow;
  const [runs, changes, notifications] = await Promise.all([
    client
      .from("sync_runs")
      .select("id,status,started_at,created_count,updated_count,missing_count,error_code")
      .eq("user_id", userId)
      .eq("account_id", accountRow.id)
      .order("started_at", { ascending: false })
      .limit(10),
    client
      .from("sync_changes")
      .select("id,change_type,summary,created_at,sync_runs!inner(account_id)")
      .eq("user_id", userId)
      .eq("sync_runs.account_id", accountRow.id)
      .order("created_at", { ascending: false })
      .limit(20),
    client
      .from("notification_events")
      .select("id,title,body,deep_link,created_at")
      .eq("user_id", userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (runs.error || changes.error || notifications.error) {
    throw runs.error ?? changes.error ?? notifications.error;
  }

  return {
    connected: accountRow.status !== "disconnected",
    credentialHint: accountRow.credential_hint,
    syncState: accountRow.sync_state,
    lastSuccessAt: accountRow.last_success_at,
    lastErrorCode: accountRow.last_error_code,
    runs: ((runs.data ?? []) as SyncRunRow[]).map((row) => ({
      id: row.id,
      status: row.status,
      startedAt: row.started_at,
      created: row.created_count,
      updated: row.updated_count,
      missing: row.missing_count,
      errorCode: row.error_code,
    })),
    changes: ((changes.data ?? []) as unknown as SyncChangeRow[]).map((row) => ({
      id: row.id,
      type: row.change_type,
      summary: row.summary,
      createdAt: row.created_at,
    })),
    notifications: ((notifications.data ?? []) as NotificationRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link,
      createdAt: row.created_at,
    })),
  };
}

export async function configureBlackboardFeed(feedUrl: string): Promise<void> {
  const validated = validateFeedUrl(feedUrl);
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.from("integration_accounts").upsert(
    {
      user_id: userId,
      provider: "blackboard",
      status: "connected",
      encrypted_credential: encryptCredential(validated.toString()),
      credential_hint: credentialHint(validated.toString()),
      last_error_code: null,
    },
    { onConflict: "user_id,provider" },
  );

  if (error) throw error;
}

export async function runBlackboardSync() {
  const { client, userId } = await requireAuthenticatedSupabase();
  const account = await client
    .from("integration_accounts")
    .select("id,encrypted_credential,sync_state")
    .eq("user_id", userId)
    .eq("provider", "blackboard")
    .single();

  if (account.error) throw account.error;
  if (account.data.sync_state === "syncing") {
    throw new Error("A Blackboard sync is already running.");
  }

  const run = await client
    .from("sync_runs")
    .insert({
      user_id: userId,
      account_id: account.data.id,
      idempotency_key: randomUUID(),
    })
    .select("id")
    .single();

  if (run.error) throw run.error;

  try {
    const markSyncing = await client
      .from("integration_accounts")
      .update({ sync_state: "syncing", last_error_code: null })
      .eq("id", account.data.id)
      .eq("user_id", userId);
    if (markSyncing.error) throw markSyncing.error;

    const feed = await fetchBlackboardCalendar(
      decryptCredential(account.data.encrypted_credential),
    );
    const items = parseBlackboardICalendar(feed);
    const records = await client
      .from("external_records")
      .select("id,external_uid,content_hash,task_id,due_at,missing_since")
      .eq("user_id", userId)
      .eq("account_id", account.data.id);

    if (records.error) throw records.error;

    const existing: ExistingBlackboardRecord[] = (
      (records.data ?? []) as ExternalRecordRow[]
    ).map((row) => ({
      id: row.id,
      externalUid: row.external_uid,
      contentHash: row.content_hash,
      taskId: row.task_id,
      dueAt: row.due_at,
      missingSince: row.missing_since,
    }));
    const plan = planBlackboardSync(items, existing);
    let created = 0;
    let updated = 0;
    let missing = 0;

    for (const item of plan.creates) {
      const record = await client
        .from("external_records")
        .insert({
          user_id: userId,
          account_id: account.data.id,
          provider: "blackboard",
          external_uid: item.uid,
          normalized_title: item.title,
          course_code: item.courseCode,
          source_url: item.sourceUrl,
          source_updated_at: item.sourceUpdatedAt,
          due_at: item.dueAt,
          content_hash: item.contentHash,
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (record.error) throw record.error;
      await audit(client, userId, run.data.id, record.data.id, "created", item.title);
      await notify(
        client,
        userId,
        "blackboard_assignment",
        notificationDedupeKey("blackboard_assignment", record.data.id, item.contentHash),
        "New Blackboard calendar item",
        item.title,
        "/integrations/blackboard",
      );
      created += 1;
    }

    for (const change of plan.updates) {
      const result = await client
        .from("external_records")
        .update({
          normalized_title: change.item.title,
          course_code: change.item.courseCode,
          source_url: change.item.sourceUrl,
          source_updated_at: change.item.sourceUpdatedAt,
          due_at: change.item.dueAt,
          content_hash: change.item.contentHash,
          last_seen_at: new Date().toISOString(),
          missing_since: null,
        })
        .eq("id", change.record.id)
        .eq("user_id", userId);

      if (result.error) throw result.error;
      await audit(
        client,
        userId,
        run.data.id,
        change.record.id,
        "updated",
        change.item.title,
      );
      if (change.record.dueAt !== change.item.dueAt) {
        await notify(
          client,
          userId,
          "blackboard_deadline_changed",
          notificationDedupeKey(
            "blackboard_deadline_changed",
            change.record.id,
            change.item.contentHash,
          ),
          "Blackboard deadline changed",
          change.item.title,
          "/integrations/blackboard",
        );
      }
      updated += 1;
    }

    for (const record of plan.unchanged) {
      const result = await client
        .from("external_records")
        .update({ last_seen_at: new Date().toISOString(), missing_since: null })
        .eq("id", record.id)
        .eq("user_id", userId);
      if (result.error) throw result.error;
    }

    for (const record of plan.missing) {
      const result = await client
        .from("external_records")
        .update({ missing_since: new Date().toISOString() })
        .eq("id", record.id)
        .eq("user_id", userId);
      if (result.error) throw result.error;

      await audit(
        client,
        userId,
        run.data.id,
        record.id,
        "missing",
        "Source item is no longer present and was not deleted.",
      );
      missing += 1;
    }

    const completedAt = new Date().toISOString();
    const completeRun = await client
      .from("sync_runs")
      .update({
        status: "succeeded",
        completed_at: completedAt,
        seen_count: items.length,
        created_count: created,
        updated_count: updated,
        missing_count: missing,
      })
      .eq("id", run.data.id)
      .eq("user_id", userId);
    if (completeRun.error) throw completeRun.error;

    const completeAccount = await client
      .from("integration_accounts")
      .update({
        sync_state: "idle",
        status: "connected",
        last_success_at: completedAt,
        last_error_code: null,
      })
      .eq("id", account.data.id)
      .eq("user_id", userId);
    if (completeAccount.error) throw completeAccount.error;

    return { created, updated, missing };
  } catch (error) {
    const code = integrationErrorCode(error);
    const completedAt = new Date().toISOString();

    await Promise.all([
      client
        .from("sync_runs")
        .update({ status: "failed", completed_at: completedAt, error_code: code })
        .eq("id", run.data.id)
        .eq("user_id", userId),
      client
        .from("integration_accounts")
        .update({ sync_state: "failed", status: "attention", last_error_code: code })
        .eq("id", account.data.id)
        .eq("user_id", userId),
      notify(
        client,
        userId,
        "sync_failure",
        notificationDedupeKey("sync_failure", account.data.id, run.data.id),
        "Blackboard sync needs attention",
        "Open Integrations to review the latest sync.",
        "/integrations/blackboard",
      ),
    ]);

    throw error;
  }
}

function integrationErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return "sync_failed";
}

async function notify(
  client: AuthenticatedClient,
  userId: string,
  type: string,
  dedupe: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  await client.from("notification_events").upsert(
    {
      user_id: userId,
      event_type: type,
      dedupe_key: dedupe,
      title,
      body,
      deep_link: link,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

async function audit(
  client: AuthenticatedClient,
  userId: string,
  runId: string,
  recordId: string,
  type: string,
  summary: string,
): Promise<void> {
  const result = await client.from("sync_changes").insert({
    user_id: userId,
    sync_run_id: runId,
    external_record_id: recordId,
    change_type: type,
    summary: summary.slice(0, 300),
  });
  if (result.error) throw result.error;
}
