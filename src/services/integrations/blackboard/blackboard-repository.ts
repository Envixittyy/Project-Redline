import "server-only";

import { randomUUID } from "node:crypto";

import { resolveTimeZone } from "@/lib/date/day";
import { getSupabaseAdminClient } from "@/services/supabase/admin";
import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { ExternalCalendarProjection } from "@/types/external-calendar";

import {
  listBlackboardCourseMappings,
  listUnassignedBlackboardRecords,
  type BlackboardCourseMapping,
  type UnassignedBlackboardRecord,
} from "./blackboard-mapping-repository";
import { BlackboardIcsCurrentStateAdapter } from "./current-state-adapter";
import { credentialHint, decryptCredential, encryptCredential } from "./credential";
import type { BlackboardCalendarCharacterization } from "./characterization";
import { BlackboardCalendarParseError } from "./ical";
import { BlackboardFetchError } from "./safe-fetch";
import {
  BlackboardUrlError,
  normalizeFeedHostname,
  validateFeedUrl,
} from "./safe-url";
import {
  blackboardRecordToExternalCalendarProjection,
  type BlackboardRecordForCalendar,
} from "./sync-domain";

type BlackboardAccountRow = {
  id: string;
  status: string;
  credential_hint: string | null;
  sync_state: string;
  course_mappings: Record<string, string> | null;
  last_success_at: string | null;
  last_error_code: string | null;
  blackboard_sync_mode: BlackboardSyncMode;
  encrypted_credential?: string;
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
  details: Record<string, unknown> | null;
};

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  deep_link: string;
  created_at: string;
};

type CourseRow = {
  id: string;
  code: string;
  name: string;
  color: string | null;
};

export type BlackboardStatus = {
  connected: boolean;
  accountId: string | null;
  credentialHint: string | null;
  syncState: string;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  mode: BlackboardSyncMode;
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    created: number;
    updated: number;
    missing: number;
    errorCode: string | null;
  }>;
  changes: Array<{
    id: string;
    type: string;
    summary: string;
    createdAt: string;
    reason: string | null;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    deepLink: string;
    createdAt: string;
  }>;
  mappings: BlackboardCourseMapping[];
  unassigned: UnassignedBlackboardRecord[];
  courses: CourseRow[];
};

export type BlackboardSyncMode = "off" | "observe" | "apply";

export type BlackboardSyncResult = {
  seen: number;
  created: number;
  updated: number;
  missing: number;
  unresolved: number;
  applied: number;
  mode: Exclude<BlackboardSyncMode, "off">;
};

function configuredBlackboardHosts(): string[] {
  const configured = (process.env.SCHOOL_BLACKBOARD_HOSTS ?? "")
    .split(",")
    .map((value) => normalizeFeedHostname(value.trim()))
    .filter(Boolean);
  if (configured.length === 0) {
    throw new BlackboardUrlError(
      "untrusted_host",
      "Configure SCHOOL_BLACKBOARD_HOSTS before connecting a Blackboard calendar.",
    );
  }
  return [...new Set(configured)];
}

function safeSyncErrorCode(error: unknown): string {
  if (
    error instanceof BlackboardFetchError ||
    error instanceof BlackboardUrlError ||
    error instanceof BlackboardCalendarParseError
  ) {
    return error.code.slice(0, 80);
  }
  return "blackboard_calendar_sync_failed";
}

async function connectedAccountWithCredential() {
  const auth = await requireAuthenticatedSupabase();
  const result = await auth.client
    .from("integration_accounts")
    .select("id,status,credential_hint,encrypted_credential,blackboard_sync_mode")
    .eq("user_id", auth.userId)
    .eq("provider", "blackboard")
    .eq("status", "connected")
    .single();
  if (result.error || !result.data) throw new Error("Connect Blackboard before synchronizing.");
  const account = result.data as BlackboardAccountRow;
  if (account.blackboard_sync_mode === "off") {
    throw new Error("Blackboard calendar synchronization is off.");
  }
  if (!account.encrypted_credential || !account.credential_hint) {
    throw new Error("The Blackboard calendar credential is unavailable.");
  }
  return { ...auth, account };
}

export async function getBlackboardStatus(): Promise<BlackboardStatus> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const account = await client
    .from("integration_accounts")
    .select("id,status,credential_hint,sync_state,course_mappings,last_success_at,last_error_code,blackboard_sync_mode")
    .eq("user_id", userId)
    .eq("provider", "blackboard")
    .maybeSingle();

  if (account.error) throw account.error;
  if (!account.data) {
    return {
      connected: false,
      accountId: null,
      credentialHint: null,
      syncState: "idle",
      lastSuccessAt: null,
      lastErrorCode: null,
      mode: "off",
      runs: [],
      changes: [],
      notifications: [],
      mappings: [],
      unassigned: [],
      courses: [],
    };
  }

  const accountRow = account.data as BlackboardAccountRow;
  const [runs, changes, notifications, mappings, unassigned, coursesResult] = await Promise.all([
    client
      .from("sync_runs")
      .select("id,status,started_at,created_count,updated_count,missing_count,error_code")
      .eq("user_id", userId)
      .eq("account_id", accountRow.id)
      .order("started_at", { ascending: false })
      .limit(10),
    client
      .from("sync_changes")
      .select("id,change_type,summary,created_at,details,sync_runs!inner(account_id)")
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
    listBlackboardCourseMappings(accountRow.id),
    listUnassignedBlackboardRecords(accountRow.id),
    client
      .from("courses")
      .select("id,code,name,color")
      .eq("user_id", userId)
      .order("code", { ascending: true }),
  ]);

  if (runs.error || changes.error || notifications.error || coursesResult.error) {
    throw runs.error ?? changes.error ?? notifications.error ?? coursesResult.error;
  }

  return {
    connected: accountRow.status !== "disconnected",
    accountId: accountRow.id,
    credentialHint: accountRow.credential_hint,
    syncState: accountRow.sync_state,
    lastSuccessAt: accountRow.last_success_at,
    lastErrorCode: accountRow.last_error_code,
    mode: accountRow.blackboard_sync_mode ?? "off",
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
      reason: typeof row.details?.reason === "string" ? row.details.reason : null,
    })),
    notifications: ((notifications.data ?? []) as NotificationRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link,
      createdAt: row.created_at,
    })),
    mappings,
    unassigned,
    courses: (coursesResult.data ?? []) as CourseRow[],
  };
}

export async function configureBlackboardFeed(feedUrl: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const preliminary = validateFeedUrl(feedUrl);
  const allowedHosts = configuredBlackboardHosts();
  const url = validateFeedUrl(preliminary.toString(), allowedHosts);

  // Validate the credential and characterize the response before persistence.
  // This is observation-only and cannot reach School/Task mutation code.
  await new BlackboardIcsCurrentStateAdapter(allowedHosts).read(url.toString());

  const encryptedCredential = encryptCredential(url.toString());
  const result = await client.from("integration_accounts").upsert(
    {
      user_id: userId,
      provider: "blackboard",
      status: "connected",
      encrypted_credential: encryptedCredential,
      credential_hint: credentialHint(url.toString()),
      sync_state: "idle",
      last_error_code: null,
      blackboard_sync_mode: "observe",
    },
    { onConflict: "user_id,provider" },
  );
  if (result.error) throw result.error;
}

export async function runBlackboardSync(): Promise<BlackboardSyncResult> {
  const { client, userId, account } = await connectedAccountWithCredential();
  const mode = account.blackboard_sync_mode as Exclude<BlackboardSyncMode, "off">;
  const runResult = await client
    .from("sync_runs")
    .insert({
      user_id: userId,
      account_id: account.id,
      idempotency_key: randomUUID(),
      sync_mode: mode,
    })
    .select("id")
    .single();
  if (runResult.error || !runResult.data) throw runResult.error ?? new Error("Could not start sync.");
  const runId = runResult.data.id as string;
  await client
    .from("integration_accounts")
    .update({ sync_state: "syncing" })
    .eq("id", account.id)
    .eq("user_id", userId);

  try {
    const rawCredential = decryptCredential(account.encrypted_credential!);
    const allowedHosts = configuredBlackboardHosts();
    const url = validateFeedUrl(rawCredential, allowedHosts);
    if (normalizeFeedHostname(url.hostname) !== normalizeFeedHostname(account.credential_hint!)) {
      throw new BlackboardUrlError("credential_host_changed", "The stored Blackboard host changed unexpectedly.");
    }
    const snapshot = await new BlackboardIcsCurrentStateAdapter(allowedHosts).read(url.toString());
    const admin = getSupabaseAdminClient();
    const reconciled = await admin.rpc("reconcile_blackboard_calendar_snapshot", {
      p_user_id: userId,
      p_account_id: account.id,
      p_run_id: runId,
      p_observations: snapshot.observations,
    });
    if (reconciled.error || !reconciled.data) {
      throw reconciled.error ?? new Error("Blackboard reconciliation returned no result.");
    }
    return reconciled.data as BlackboardSyncResult;
  } catch (error) {
    const errorCode = safeSyncErrorCode(error);
    await Promise.all([
      client
        .from("sync_runs")
        .update({ status: "failed", completed_at: new Date().toISOString(), error_code: errorCode })
        .eq("id", runId)
        .eq("user_id", userId),
      client
        .from("integration_accounts")
        .update({ sync_state: "failed", last_error_code: errorCode })
        .eq("id", account.id)
        .eq("user_id", userId),
    ]);
    throw error;
  }
}

export async function characterizeConfiguredBlackboardFeed(): Promise<BlackboardCalendarCharacterization> {
  const { account } = await connectedAccountWithCredential();
  const rawCredential = decryptCredential(account.encrypted_credential!);
  const allowedHosts = configuredBlackboardHosts();
  const url = validateFeedUrl(rawCredential, allowedHosts);
  if (normalizeFeedHostname(url.hostname) !== normalizeFeedHostname(account.credential_hint!)) {
    throw new BlackboardUrlError("credential_host_changed", "The stored Blackboard host changed unexpectedly.");
  }
  return (await new BlackboardIcsCurrentStateAdapter(allowedHosts).read(url.toString())).characterization;
}
export {
  blackboardRecordToExternalCalendarProjection,
  type BlackboardRecordForCalendar,
};

export async function listBlackboardCalendarProjectionsInRange(
  start: string,
  end: string,
  timeZone = resolveTimeZone(),
): Promise<ExternalCalendarProjection[]> {
  const { client, userId } = await requireAuthenticatedSupabase();

  const { data, error } = await client
    .from("external_records")
    .select("id,account_id,external_uid,task_id,school_item_id,normalized_title,course_code,course_id,source_url,due_at,due_date,due_precision,content_hash,missing_since,courses(id,code,name,color)")
    .eq("user_id", userId)
    .eq("provider", "blackboard")
    .is("missing_since", null)
    .is("task_id", null)
    .is("school_item_id", null)
    .limit(500);

  if (error) {
    console.error(
      `[blackboard] Failed to load calendar records: ${formatPostgrestErrorDiagnostic(error)}`,
    );
    throw error;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  const projections: ExternalCalendarProjection[] = [];
  type CourseItem = { id: string; code: string; name: string; color: string | null };
  type QueryRow = BlackboardRecordForCalendar & {
    courses: CourseItem | CourseItem[] | null;
  };

  for (const row of ((data ?? []) as unknown as QueryRow[])) {
    const course = Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses;
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        ...row,
        course,
      },
      timeZone,
    );

    if (!projection) continue;

    const projStartMs = Date.parse(projection.startsAt);
    const projEndMs = Date.parse(projection.endsAt);

    if (projStartMs < endMs && projEndMs > startMs) {
      projections.push(projection);
    }
  }

  return projections;
}
