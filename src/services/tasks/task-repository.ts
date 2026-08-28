import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { addDays, dayRangeIn, resolveTimeZone, todayIn } from "@/lib/date/day";
import { getSupabaseClient } from "@/services/supabase/server";
import {
  openTaskStatuses,
  type Task,
  type TaskDraft,
  type TaskPatch,
  type TaskPriority,
  type TaskStatus,
  type TaskView,
  type SmartListId,
} from "@/types/task";

const TABLE = "tasks";

const COLUMNS =
  "id, title, description, status, priority, due_date, due_at, scheduled_start, scheduled_end, area, project, course, created_at, updated_at, completed_at";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  due_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  area: string | null;
  project: string | null;
  course: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export class TaskRepositoryError extends Error {
  readonly detail?: PostgrestError;

  constructor(message: string, detail?: PostgrestError) {
    super(message);
    this.name = "TaskRepositoryError";
    this.detail = detail;
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    dueAt: row.due_at,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    area: row.area,
    project: row.project,
    course: row.course,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** PostgREST splits or-arguments on dots and commas, so timestamps must be quoted. */
function quote(value: string): string {
  return '"' + value + '"';
}

function toRow(draft: TaskDraft | TaskPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (draft.title !== undefined) row.title = draft.title.trim();
  if (draft.description !== undefined) row.description = emptyToNull(draft.description);
  if (draft.status !== undefined) row.status = draft.status;
  if (draft.priority !== undefined) row.priority = draft.priority;
  if (draft.dueDate !== undefined) row.due_date = emptyToNull(draft.dueDate);
  if (draft.dueAt !== undefined) row.due_at = emptyToNull(draft.dueAt);
  if (draft.scheduledStart !== undefined) row.scheduled_start = emptyToNull(draft.scheduledStart);
  if (draft.scheduledEnd !== undefined) row.scheduled_end = emptyToNull(draft.scheduledEnd);
  if (draft.area !== undefined) row.area = emptyToNull(draft.area);
  if (draft.project !== undefined) row.project = emptyToNull(draft.project);
  if (draft.course !== undefined) row.course = emptyToNull(draft.course);

  return row;
}

function fail(action: string, error: PostgrestError): never {
  // Surface the real cause in server logs; callers translate it to a UI message.
  console.error("[tasks] " + action + " failed:", error);
  throw new TaskRepositoryError("Could not " + action + ". " + error.message, error);
}

/**
 * Tasks matching a view.
 *
 * Dated views combine two independent signals that both live on the task row:
 * the due date (a calendar day) and the scheduled start (an instant). Neither is
 * a calendar event, and no event table is consulted.
 */
export async function listTasksForView(view: TaskView): Promise<Task[]> {
  const supabase = getSupabaseClient();
  const timeZone = resolveTimeZone();
  const today = todayIn(timeZone);
  const tomorrow = addDays(today, 1);

  let query = supabase.from(TABLE).select(COLUMNS);

  switch (view) {
    case "inbox": {
      query = query.eq("status", "inbox").order("created_at", { ascending: false });
      break;
    }
    case "today": {
      const { start, end } = dayRangeIn(today, tomorrow, timeZone);
      query = query
        .in("status", openTaskStatuses)
        .or(
          "due_date.eq." + today +
            ",and(scheduled_start.gte." + quote(start) +
            ",scheduled_start.lt." + quote(end) + ")",
        );
      break;
    }
    case "tomorrow": {
      const { start, end } = dayRangeIn(tomorrow, addDays(today, 2), timeZone);
      query = query
        .in("status", openTaskStatuses)
        .or(
          "due_date.eq." + tomorrow +
            ",and(scheduled_start.gte." + quote(start) +
            ",scheduled_start.lt." + quote(end) + ")",
        );
      break;
    }
    case "next7": {
      const lastDay = addDays(today, 6);
      const { start, end } = dayRangeIn(today, addDays(today, 7), timeZone);
      query = query
        .in("status", openTaskStatuses)
        .or(
          "and(due_date.gte." + today + ",due_date.lte." + lastDay + ")" +
            ",and(scheduled_start.gte." + quote(start) +
            ",scheduled_start.lt." + quote(end) + ")",
        );
      break;
    }
    case "overdue": {
      query = query.in("status", openTaskStatuses).lt("due_date", today);
      break;
    }
    case "someday": {
      query = query
        .in("status", ["todo", "in_progress"])
        .is("due_date", null)
        .is("scheduled_start", null);
      break;
    }
    case "completed": {
      query = query.eq("status", "completed").order("completed_at", { ascending: false });
      break;
    }
  }

  if (view !== "inbox" && view !== "completed") {
    query = query
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
  }

  const { data, error } = await query.limit(500);
  if (error) fail("load tasks", error);

  return (data as TaskRow[]).map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq("id", id).maybeSingle();

  if (error) fail("load the task", error);

  return data ? toTask(data as TaskRow) : null;
}

export type CalendarTaskRange = {
  scheduled: Task[];
  deadlines: Task[];
};

/**
 * Calendar task projection inputs. Scheduled intervals and deadlines are read
 * separately so neither is mistaken for the other. A task with both signals
 * intentionally appears in both result sets and is deduplicated by the domain
 * adapter before it creates one entry for each signal.
 */
export async function listTasksForCalendarRange(
  start: string,
  end: string,
  fromDate: string,
  toDateExclusive: string,
): Promise<CalendarTaskRange> {
  const supabase = getSupabaseClient();

  const [scheduledResult, deadlineResult] = await Promise.all([
    supabase
      .from(TABLE)
      .select(COLUMNS)
      .neq("status", "cancelled")
      .not("scheduled_start", "is", null)
      .lt("scheduled_start", end)
      .or(`scheduled_end.is.null,scheduled_end.gt.${quote(start)}`)
      .order("scheduled_start", { ascending: true })
      .limit(500),
    supabase
      .from(TABLE)
      .select(COLUMNS)
      .neq("status", "cancelled")
      .gte("due_date", fromDate)
      .lt("due_date", toDateExclusive)
      .order("due_date", { ascending: true })
      .limit(500),
  ]);

  if (scheduledResult.error) fail("load scheduled tasks", scheduledResult.error);
  if (deadlineResult.error) fail("load task deadlines", deadlineResult.error);

  return {
    scheduled: (scheduledResult.data as TaskRow[]).map(toTask),
    deadlines: (deadlineResult.data as TaskRow[]).map(toTask),
  };
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).insert(toRow(draft)).select(COLUMNS).single();

  if (error) fail("create the task", error);

  return toTask(data as TaskRow);
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  const supabase = getSupabaseClient();
  const row = toRow(patch);

  if (Object.keys(row).length === 0) {
    const existing = await getTask(id);
    if (!existing) throw new TaskRepositoryError("That task no longer exists.");
    return existing;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) fail("update the task", error);
  if (!data) throw new TaskRepositoryError("That task no longer exists.");

  return toTask(data as TaskRow);
}

/**
 * Completion is a status change plus its timestamp. The database enforces that
 * completed_at is set for completed tasks and null for every other status.
 */
export async function setTaskCompletion(id: string, completed: boolean): Promise<Task> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: completed ? "completed" : "todo",
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) fail(completed ? "complete the task" : "reopen the task", error);
  if (!data) throw new TaskRepositoryError("That task no longer exists.");

  return toTask(data as TaskRow);
}

/**
 * Tasks matching a smart list.
 *
 * Smart lists are more flexible than views and can combine different criteria
 * like status, priority, area, and project filters.
 */
export async function listTasksForSmartList(listId: SmartListId): Promise<Task[]> {
  const supabase = getSupabaseClient();
  const timeZone = resolveTimeZone();
  const today = todayIn(timeZone);
  const tomorrow = addDays(today, 1);

  let query = supabase.from(TABLE).select(COLUMNS);

  switch (listId) {
    case "inbox": {
      query = query.eq("status", "inbox").order("created_at", { ascending: false });
      break;
    }
    case "today": {
      const { start, end } = dayRangeIn(today, tomorrow, timeZone);
      query = query
        .in("status", openTaskStatuses)
        .or(
          "due_date.eq." + today +
            ",and(scheduled_start.gte." + quote(start) +
            ",scheduled_start.lt." + quote(end) + ")",
        );
      break;
    }
    case "tomorrow": {
      const { start, end } = dayRangeIn(tomorrow, addDays(today, 2), timeZone);
      query = query
        .in("status", openTaskStatuses)
        .or(
          "due_date.eq." + tomorrow +
            ",and(scheduled_start.gte." + quote(start) +
            ",scheduled_start.lt." + quote(end) + ")",
        );
      break;
    }
    case "next7": {
      const lastDay = addDays(today, 6);
      const { start, end } = dayRangeIn(today, addDays(today, 7), timeZone);
      query = query
        .in("status", openTaskStatuses)
        .or(
          "and(due_date.gte." + today + ",due_date.lte." + lastDay + ")" +
            ",and(scheduled_start.gte." + quote(start) +
            ",scheduled_start.lt." + quote(end) + ")",
        );
      break;
    }
    case "overdue": {
      query = query.in("status", openTaskStatuses).lt("due_date", today);
      break;
    }
    case "someday": {
      query = query
        .in("status", ["todo", "in_progress"])
        .is("due_date", null)
        .is("scheduled_start", null);
      break;
    }
    case "completed": {
      query = query.eq("status", "completed").order("completed_at", { ascending: false });
      break;
    }
    case "submitted": {
      query = query.eq("status", "submitted").order("updated_at", { ascending: false });
      break;
    }
    case "in_progress": {
      query = query.eq("status", "in_progress").order("updated_at", { ascending: false });
      break;
    }
    case "cancelled": {
      query = query.eq("status", "cancelled").order("updated_at", { ascending: false });
      break;
    }
    case "urgent": {
      query = query
        .in("status", openTaskStatuses)
        .eq("priority", "urgent")
        .order("due_date", { ascending: true });
      break;
    }
    case "high_priority": {
      query = query
        .in("status", openTaskStatuses)
        .eq("priority", "high")
        .order("due_date", { ascending: true });
      break;
    }
    case "medium_priority": {
      query = query
        .in("status", openTaskStatuses)
        .eq("priority", "medium")
        .order("due_date", { ascending: true });
      break;
    }
    case "low_priority": {
      query = query
        .in("status", openTaskStatuses)
        .eq("priority", "low")
        .order("due_date", { ascending: true });
      break;
    }
  }

  if (listId !== "inbox" && listId !== "completed" && listId !== "submitted" &&
      listId !== "in_progress" && listId !== "cancelled") {
    query = query
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
  }

  const { data, error } = await query.limit(500);
  if (error) fail("load tasks", error);

  return (data as TaskRow[]).map(toTask);
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) fail("delete the task", error);
}
