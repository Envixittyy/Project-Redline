import type { BlackboardFeedItem, DuePrecision } from "./ical";

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

  const mapped = known[code];
  if (mapped && courses.some((course) => course.id === mapped)) {
    return { kind: "matched" as const, courseId: mapped, method: "known" as const };
  }

  const normalized = code.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const candidates = courses.filter(
    (course) =>
      course.code.replace(/[^a-z0-9]/gi, "").toLowerCase() === normalized ||
      course.name.replace(/[^a-z0-9]/gi, "").toLowerCase() === normalized,
  );

  if (candidates.length === 1) {
    return {
      kind: "matched" as const,
      courseId: candidates[0].id,
      method: "normalized" as const,
    };
  }
  if (candidates.length > 1) {
    return { kind: "ambiguous" as const, candidateIds: candidates.map((course) => course.id) };
  }
  return { kind: "none" as const };
}
