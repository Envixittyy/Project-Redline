import "server-only";

import { resolveTimeZone } from "@/lib/date/day";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { ExternalCalendarProjection } from "@/types/external-calendar";

import {
  listBlackboardCourseMappings,
  listUnassignedBlackboardRecords,
  type BlackboardCourseMapping,
  type UnassignedBlackboardRecord,
} from "./blackboard-mapping-repository";
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
  mappings: BlackboardCourseMapping[];
  unassigned: UnassignedBlackboardRecord[];
  courses: CourseRow[];
};

export async function getBlackboardStatus(): Promise<BlackboardStatus> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const account = await client
    .from("integration_accounts")
    .select("id,status,credential_hint,sync_state,course_mappings,last_success_at,last_error_code")
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
    mappings,
    unassigned,
    courses: (coursesResult.data ?? []) as CourseRow[],
  };
}

/** Calendar ingestion was removed by the explicit Phase S1 product decision. */
export async function configureBlackboardFeed(_feedUrl: string): Promise<void> {
  void _feedUrl;
  throw new Error("Blackboard Calendar sync was removed. Configure School email ingestion instead.");
}

export async function runBlackboardSync(): Promise<{ seen: number; created: number; updated: number; missing: number; unassigned: number }> {
  throw new Error("Blackboard Calendar sync was removed. Configure School email ingestion instead.");
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
    .select("id,account_id,external_uid,task_id,normalized_title,course_code,course_id,source_url,due_at,due_date,due_precision,content_hash,missing_since,courses(id,code,name,color)")
    .eq("user_id", userId)
    .eq("provider", "blackboard")
    .is("missing_since", null)
    .is("task_id", null)
    .limit(500);

  if (error) {
    console.error("[blackboard] Failed to load calendar records:", error);
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
