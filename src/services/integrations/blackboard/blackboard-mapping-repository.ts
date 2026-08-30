import "server-only";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { DuePrecision } from "./ical";

export type BlackboardCourseMapping = {
  id: string;
  accountId: string;
  sourceCourseName: string;
  courseId: string;
  course: {
    id: string;
    code: string;
    name: string;
    color: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type UnassignedBlackboardRecord = {
  id: string;
  accountId: string;
  externalUid: string;
  title: string;
  description: string | null;
  sourceCourseName: string | null;
  dueDate: string | null;
  dueAt: string | null;
  duePrecision: DuePrecision;
  sourceUrl: string | null;
  proposalId: string | null;
  proposalStatus: string | null;
};

export async function listBlackboardCourseMappings(
  accountId?: string,
): Promise<BlackboardCourseMapping[]> {
  const { client, userId } = await requireAuthenticatedSupabase();

  let query = client
    .from("blackboard_course_mappings")
    .select("id,account_id,source_course_name,course_id,created_at,updated_at,courses(id,code,name,color)")
    .eq("user_id", userId)
    .order("source_course_name", { ascending: true });

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query;
  if (error) throw error;

  type MappingRow = {
    id: string;
    account_id: string;
    source_course_name: string;
    course_id: string;
    created_at: string;
    updated_at: string;
    courses: { id: string; code: string; name: string; color: string | null } | Array<{ id: string; code: string; name: string; color: string | null }> | null;
  };

  return ((data ?? []) as unknown as MappingRow[]).map((row) => {
    const courseObj = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    return {
      id: row.id,
      accountId: row.account_id,
      sourceCourseName: row.source_course_name,
      courseId: row.course_id,
      course: courseObj ?? {
        id: row.course_id,
        code: "UNKNOWN",
        name: "Unknown Course",
        color: null,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function saveBlackboardCourseMapping(
  accountId: string,
  sourceCourseName: string,
  courseId: string,
): Promise<{ id: string }> {
  const { client } = await requireAuthenticatedSupabase();
  const normalizedSource = sourceCourseName.trim();
  if (!normalizedSource) {
    throw new Error("Source course name cannot be blank.");
  }

  const { data, error } = await client.rpc("upsert_blackboard_course_mapping", {
    target_account_id: accountId,
    target_source_course_name: normalizedSource,
    target_course_id: courseId,
  });

  if (error) throw error;
  return { id: data as string };
}

export async function deleteBlackboardCourseMapping(mappingId: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client
    .from("blackboard_course_mappings")
    .delete()
    .eq("id", mappingId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function listUnassignedBlackboardRecords(
  accountId?: string,
): Promise<UnassignedBlackboardRecord[]> {
  const { client, userId } = await requireAuthenticatedSupabase();

  let query = client
    .from("external_records")
    .select("id,account_id,external_uid,normalized_title,normalized_description,course_code,due_date,due_at,due_precision,source_url,capture_proposals(id,status)")
    .eq("user_id", userId)
    .eq("provider", "blackboard")
    .is("course_id", null)
    .is("missing_since", null)
    .is("task_id", null)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query;
  if (error) throw error;

  type UnassignedRow = {
    id: string;
    account_id: string;
    external_uid: string;
    normalized_title: string;
    normalized_description: string | null;
    course_code: string | null;
    due_date: string | null;
    due_at: string | null;
    due_precision: DuePrecision;
    source_url: string | null;
    capture_proposals: Array<{ id: string; status: string }> | { id: string; status: string } | null;
  };

  return ((data ?? []) as unknown as UnassignedRow[]).map((row) => {
    const proposal = Array.isArray(row.capture_proposals)
      ? row.capture_proposals[0]
      : row.capture_proposals;

    return {
      id: row.id,
      accountId: row.account_id,
      externalUid: row.external_uid,
      title: row.normalized_title,
      description: row.normalized_description,
      sourceCourseName: row.course_code,
      dueDate: row.due_date,
      dueAt: row.due_at,
      duePrecision: row.due_precision,
      sourceUrl: row.source_url,
      proposalId: proposal?.id ?? null,
      proposalStatus: proposal?.status ?? null,
    };
  });
}

export async function assignCourseToBlackboardRecords(
  recordIds: string[],
  courseId: string,
  rememberMapping = true,
): Promise<{ assignedCount: number }> {
  if (!recordIds.length) return { assignedCount: 0 };
  const { client } = await requireAuthenticatedSupabase();

  const { data, error } = await client.rpc("bulk_assign_blackboard_records", {
    target_record_ids: recordIds,
    target_course_id: courseId,
    remember_mapping: rememberMapping,
  });

  if (error) throw error;
  return { assignedCount: Number(data) || 0 };
}
