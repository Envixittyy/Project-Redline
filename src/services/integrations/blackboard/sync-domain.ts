import { addDays, fromZonedInputValue, isIsoDate, isIsoInstant } from "@/lib/date/day";
import type { ExternalCalendarProjection } from "@/types/external-calendar";

import type { BlackboardFeedItem, DuePrecision } from "./ical";

export type BlackboardRecordForCalendar = {
  id: string;
  account_id?: string | null;
  external_uid: string;
  task_id?: string | null;
  school_item_id?: string | null;
  normalized_title: string;
  course_code?: string | null;
  course_id?: string | null;
  source_url?: string | null;
  due_at?: string | null;
  due_date?: string | null;
  due_precision: DuePrecision;
  content_hash: string;
  missing_since?: string | null;
  course?: { id: string; code: string; name: string; color: string | null } | null;
};

export type ExistingBlackboardRecord = {
  id: string;
  externalUid: string;
  contentHash: string;
  proposalRevision?: string | null;
  taskId: string | null;
  dueAt: string | null;
  dueDate?: string | null;
  duePrecision?: DuePrecision;
  courseId?: string | null;
  normalizedDescription?: string | null;
  missingSince: string | null;
};

export function blackboardRecordToExternalCalendarProjection(
  record: BlackboardRecordForCalendar,
  timeZone: string,
): ExternalCalendarProjection | null {
  if (record.missing_since || record.task_id || record.school_item_id) return null;

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  let allDay = false;

  if (record.due_precision === "instant" && record.due_at && isIsoInstant(record.due_at)) {
    startsAt = new Date(record.due_at).toISOString();
    endsAt = new Date(Date.parse(record.due_at) + 3600_000).toISOString();
    allDay = false;
  } else if (record.due_precision === "date" && record.due_date && isIsoDate(record.due_date)) {
    startsAt = fromZonedInputValue(`${record.due_date}T00:00`, timeZone);
    endsAt = fromZonedInputValue(`${addDays(record.due_date, 1)}T00:00`, timeZone);
    allDay = true;
  } else if (record.due_precision === "unresolved") {
    if (record.due_at && isIsoInstant(record.due_at)) {
      startsAt = new Date(record.due_at).toISOString();
      endsAt = new Date(Date.parse(record.due_at) + 3600_000).toISOString();
      allDay = false;
    } else if (record.due_date && isIsoDate(record.due_date)) {
      startsAt = fromZonedInputValue(`${record.due_date}T00:00`, timeZone);
      endsAt = fromZonedInputValue(`${addDays(record.due_date, 1)}T00:00`, timeZone);
      allDay = true;
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    return null;
  }

  return {
    id: record.id,
    provider: "blackboard",
    calendarId: record.account_id ?? record.id,
    externalCalendarId: record.course_code ?? "blackboard",
    calendarName: "Blackboard",
    access: "read_only",
    externalEventId: record.external_uid,
    revision: record.content_hash,
    title: record.normalized_title,
    startsAt,
    endsAt,
    allDay,
    status: "confirmed",
    courseCode: record.course_code ?? record.course?.code ?? null,
    courseId: record.course_id ?? record.course?.id ?? null,
    courseColor: record.course?.color ?? null,
  };
}

export type BlackboardSyncPlan = {
  creates: BlackboardFeedItem[];
  updates: Array<{
    record: ExistingBlackboardRecord;
    item: BlackboardFeedItem;
  }>;
  unchanged: ExistingBlackboardRecord[];
  missing: ExistingBlackboardRecord[];
};

/**
 * Plan provider-record changes only. Blackboard feed rows never become ordinary
 * Forward tasks merely because both can appear on a calendar.
 */
export function planBlackboardSync(
  items: BlackboardFeedItem[],
  existing: ExistingBlackboardRecord[],
): BlackboardSyncPlan {
  const byUid = new Map(existing.map((record) => [record.externalUid, record]));
  const seen = new Set<string>();
  const plan: BlackboardSyncPlan = {
    creates: [],
    updates: [],
    unchanged: [],
    missing: [],
  };

  for (const item of items) {
    if (seen.has(item.uid)) continue;
    seen.add(item.uid);

    const record = byUid.get(item.uid);
    if (!record) {
      plan.creates.push(item);
      continue;
    }
    if (record.contentHash === item.contentHash) {
      plan.unchanged.push(record);
      continue;
    }

    plan.updates.push({ record, item });
  }

  for (const record of existing) {
    if (!seen.has(record.externalUid) && !record.missingSince) {
      plan.missing.push(record);
    }
  }

  return plan;
}

export function matchBlackboardCourse(
  code: string | null,
  courses: Array<{ id: string; code: string; name: string }>,
  known: Record<string, string>,
) {
  if (!code) return { kind: "none" as const };

  const trimmed = code.trim();
  const mapped = known[trimmed] || known[code];
  if (mapped && courses.some((course) => course.id === mapped)) {
    return { kind: "matched" as const, courseId: mapped, method: "known" as const };
  }

  return { kind: "none" as const };
}

