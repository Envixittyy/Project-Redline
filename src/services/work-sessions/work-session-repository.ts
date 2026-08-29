import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { WorkSession, WorkSessionDraft } from "@/types/work-session";

const COLUMNS =
  "id,task_id,starts_at,ends_at,status,source,completed_at,created_at,updated_at";

type WorkSessionRow = {
  id: string;
  task_id: string;
  starts_at: string;
  ends_at: string;
  status: WorkSession["status"];
  source: WorkSession["source"];
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export class WorkSessionRepositoryError extends Error {
  constructor(message: string, readonly detail?: PostgrestError) {
    super(message);
    this.name = "WorkSessionRepositoryError";
  }
}

function fail(action: string, error: PostgrestError): never {
  console.error(`[work-sessions] ${action} failed: ${formatPostgrestErrorDiagnostic(error)}`);
  throw new WorkSessionRepositoryError(`Could not ${action}. Please try again.`, error);
}

function toWorkSession(row: WorkSessionRow): WorkSession {
  return {
    id: row.id,
    taskId: row.task_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    source: row.source,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkSessionsInRange(start: string, end: string): Promise<WorkSession[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("task_work_sessions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .lt("starts_at", end)
    .gt("ends_at", start)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) fail("load work sessions", error);
  return (data as WorkSessionRow[]).map(toWorkSession);
}

export async function createWorkSession(draft: WorkSessionDraft): Promise<WorkSession> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("task_work_sessions")
    .insert({
      user_id: userId,
      task_id: draft.taskId,
      starts_at: draft.startsAt,
      ends_at: draft.endsAt,
      source: draft.source ?? "manual",
    })
    .select(COLUMNS)
    .single();
  if (error) fail("create the work session", error);
  return toWorkSession(data as WorkSessionRow);
}

export async function updateWorkSession(
  id: string,
  draft: WorkSessionDraft,
): Promise<WorkSession> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("task_work_sessions")
    .update({
      task_id: draft.taskId,
      starts_at: draft.startsAt,
      ends_at: draft.endsAt,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) fail("update the work session", error);
  if (!data) throw new WorkSessionRepositoryError("That work session no longer exists.");
  return toWorkSession(data as WorkSessionRow);
}

export async function deleteWorkSession(id: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("task_work_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) fail("delete the work session", error);
  if (!data) throw new WorkSessionRepositoryError("That work session no longer exists.");
}
