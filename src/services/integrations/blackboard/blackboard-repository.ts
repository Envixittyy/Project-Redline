import "server-only";

import { randomUUID } from "node:crypto";

import { resolveTimeZone } from "@/lib/date/day";
import {
  notificationDedupeKey,
  planBlackboardProposalNotification,
} from "@/services/notifications/notification-domain";
import { createNotificationEvent } from "@/services/notifications/notification-repository";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { ExternalCalendarProjection } from "@/types/external-calendar";

import {
  listBlackboardCourseMappings,
  listUnassignedBlackboardRecords,
  type BlackboardCourseMapping,
  type UnassignedBlackboardRecord,
} from "./blackboard-mapping-repository";
import { credentialHint, decryptCredential, encryptCredential } from "./credential";
import { parseBlackboardICalendar, type DuePrecision } from "./ical";
import { fetchBlackboardCalendar } from "./safe-fetch";
import { validateFeedUrl } from "./safe-url";
import {
  blackboardRecordToExternalCalendarProjection,
  matchBlackboardCourse,
  planBlackboardSync,
  type BlackboardRecordForCalendar,
  type ExistingBlackboardRecord,
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

type ExternalRecordRow = {
  id: string;
  external_uid: string;
  content_hash: string;
  proposal_revision: string | null;
  task_id: string | null;
  due_at: string | null;
  due_date: string | null;
  due_precision: DuePrecision;
  course_id: string | null;
  normalized_description: string | null;
  missing_since: string | null;
};

type CourseRow = {
  id: string;
  code: string;
  name: string;
  color: string | null;
};

type AuthenticatedClient = Awaited<
  ReturnType<typeof requireAuthenticatedSupabase>
>["client"];

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
    .select("id,encrypted_credential,sync_state,course_mappings")
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

    const [recordsResult, coursesResult, mappingsResult] = await Promise.all([
      client
        .from("external_records")
        .select("id,external_uid,content_hash,proposal_revision,task_id,due_at,due_date,due_precision,course_id,normalized_description,missing_since")
        .eq("user_id", userId)
        .eq("account_id", account.data.id),
      client
        .from("courses")
        .select("id,code,name,color")
        .eq("user_id", userId),
      client
        .from("blackboard_course_mappings")
        .select("source_course_name,course_id")
        .eq("user_id", userId)
        .eq("account_id", account.data.id),
    ]);

    if (recordsResult.error) throw recordsResult.error;
    if (coursesResult.error) throw coursesResult.error;
    if (mappingsResult.error) throw mappingsResult.error;

    const existingCourses = (coursesResult.data ?? []) as CourseRow[];

    // Build known mappings strictly from saved blackboard_course_mappings
    const knownMappings: Record<string, string> = {
      ...(account.data.course_mappings ?? {}),
    };
    for (const mapping of (mappingsResult.data ?? [])) {
      if (mapping.source_course_name && mapping.course_id) {
        knownMappings[mapping.source_course_name] = mapping.course_id;
      }
    }

    const existing: ExistingBlackboardRecord[] = (
      (recordsResult.data ?? []) as ExternalRecordRow[]
    ).map((row) => ({
      id: row.id,
      externalUid: row.external_uid,
      contentHash: row.content_hash,
      proposalRevision: row.proposal_revision,
      taskId: row.task_id,
      dueAt: row.due_at,
      dueDate: row.due_date,
      duePrecision: row.due_precision,
      courseId: row.course_id,
      normalizedDescription: row.normalized_description,
      missingSince: row.missing_since,
    }));

    const plan = planBlackboardSync(items, existing);
    let created = 0;
    let updated = 0;
    let missing = 0;
    let unassigned = 0;

    for (const item of plan.creates) {
      const match = matchBlackboardCourse(item.courseCode, existingCourses, knownMappings);
      const courseId = match.kind === "matched" ? match.courseId : null;
      if (!courseId) {
        unassigned += 1;
      }

      const record = await client
        .from("external_records")
        .insert({
          user_id: userId,
          account_id: account.data.id,
          provider: "blackboard",
          external_uid: item.uid,
          normalized_title: item.title,
          normalized_description: item.description,
          course_code: item.courseCode,
          course_id: courseId,
          source_url: item.sourceUrl,
          source_updated_at: item.sourceUpdatedAt,
          due_at: item.dueAt,
          due_date: item.dueDate,
          due_precision: item.duePrecision,
          content_hash: item.contentHash,
          proposal_revision: item.proposalRevision,
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (record.error) throw record.error;

      await audit(client, userId, run.data.id, record.data.id, "created", item.title);

      // Phase 7A / 7C: If stable UID, reconcile with Universal Capture proposal
      if (!item.isFallbackUid) {
        const reconcileRes = await client.rpc("reconcile_blackboard_proposal", {
          target_external_record_id: record.data.id,
          proposed_title: item.title,
          proposed_description: item.description,
          proposed_due_date: item.dueDate,
          proposed_due_at: item.dueAt,
          proposed_due_precision: item.duePrecision,
          proposed_course_id: courseId,
          next_proposal_revision: item.proposalRevision,
          snapshot: {
            uid: item.uid,
            sourceUrl: item.sourceUrl,
            courseCode: item.courseCode,
          },
        });

        if (reconcileRes.error) throw reconcileRes.error;

        const propRow = (reconcileRes.data as Array<{ proposal_id: string; proposal_status: string }> | null)?.[0];
        const propId = propRow?.proposal_id ?? null;
        const propStatus = propRow?.proposal_status ?? "proposed";

        // Plan and emit notification for new reviewable proposal
        const plannedNotification = planBlackboardProposalNotification({
          externalRecordId: record.data.id,
          proposalId: propId,
          proposalStatus: propStatus,
          proposalRevision: item.proposalRevision,
          title: item.title,
          courseCode: item.courseCode,
          courseId,
          isFallbackUid: item.isFallbackUid,
          isCreate: true,
        });

        if (plannedNotification) {
          await createNotificationEvent(client, {
            userId,
            eventType: plannedNotification.eventType,
            dedupeKey: plannedNotification.dedupeKey,
            title: plannedNotification.title,
            body: plannedNotification.body,
            deepLink: plannedNotification.deepLink,
            courseId: plannedNotification.courseId,
          });
        }
      }

      created += 1;
    }

    for (const change of plan.updates) {
      const match = matchBlackboardCourse(change.item.courseCode, existingCourses, knownMappings);
      const courseId = match.kind === "matched" ? match.courseId : change.record.courseId;
      if (!courseId) {
        unassigned += 1;
      }

      const result = await client
        .from("external_records")
        .update({
          normalized_title: change.item.title,
          normalized_description: change.item.description,
          course_code: change.item.courseCode,
          course_id: courseId,
          source_url: change.item.sourceUrl,
          source_updated_at: change.item.sourceUpdatedAt,
          due_at: change.item.dueAt,
          due_date: change.item.dueDate,
          due_precision: change.item.duePrecision,
          content_hash: change.item.contentHash,
          proposal_revision: change.item.proposalRevision,
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

      // Reconcile proposal with updated material source fields
      if (!change.item.isFallbackUid) {
        const reconcileRes = await client.rpc("reconcile_blackboard_proposal", {
          target_external_record_id: change.record.id,
          proposed_title: change.item.title,
          proposed_description: change.item.description,
          proposed_due_date: change.item.dueDate,
          proposed_due_at: change.item.dueAt,
          proposed_due_precision: change.item.duePrecision,
          proposed_course_id: courseId,
          next_proposal_revision: change.item.proposalRevision,
          snapshot: {
            uid: change.item.uid,
            sourceUrl: change.item.sourceUrl,
            courseCode: change.item.courseCode,
          },
        });

        if (reconcileRes.error) throw reconcileRes.error;

        const propRow = (reconcileRes.data as Array<{ proposal_id: string; proposal_status: string }> | null)?.[0];
        const propId = propRow?.proposal_id ?? null;
        const propStatus = propRow?.proposal_status ?? "proposed";

        const deadlineChanged =
          change.record.dueAt !== change.item.dueAt ||
          change.record.dueDate !== change.item.dueDate;

        // Plan and emit notification for updated/reopened/divergent proposal
        const plannedNotification = planBlackboardProposalNotification({
          externalRecordId: change.record.id,
          proposalId: propId,
          proposalStatus: propStatus,
          proposalRevision: change.item.proposalRevision,
          previousProposalRevision: change.record.proposalRevision,
          title: change.item.title,
          courseCode: change.item.courseCode,
          courseId,
          isFallbackUid: change.item.isFallbackUid,
          isCreate: false,
          deadlineChanged,
        });

        if (plannedNotification) {
          await createNotificationEvent(client, {
            userId,
            eventType: plannedNotification.eventType,
            dedupeKey: plannedNotification.dedupeKey,
            title: plannedNotification.title,
            body: plannedNotification.body,
            deepLink: plannedNotification.deepLink,
            courseId: plannedNotification.courseId,
          });
        }
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

    return { created, updated, missing, unassigned };
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
      createNotificationEvent(client, {
        userId,
        eventType: "sync_failure",
        dedupeKey: notificationDedupeKey("sync_failure", account.data.id, run.data.id),
        title: "Blackboard sync needs attention",
        body: "Open Integrations to review the latest sync.",
        deepLink: "/integrations/blackboard",
        courseId: null,
      }),
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
