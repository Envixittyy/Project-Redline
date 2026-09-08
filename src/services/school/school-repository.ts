import "server-only";
import { z } from "zod";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { SchoolEmailEvent, SchoolIngestionResult, SchoolItem } from "@/types/school-item";
import type { TaskStatus } from "@/types/task";

type ItemRow = { id: string; course_id: string; item_type: SchoolItem["itemType"]; title: string; due_date: string | null; due_at: string | null; source_url: string | null; weight: number | null; task_id: string | null; created_at: string; updated_at: string };
export async function listSchoolItems(courseId?: string): Promise<SchoolItem[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  let query = client.from("school_items").select("id,course_id,item_type,title,due_date,due_at,source_url,weight,task_id,created_at,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(200);
  if (courseId) query = query.eq("course_id", z.uuid().parse(courseId));
  const { data, error } = await query;
  if (error) throw new Error("Could not load School items.");
  const rows = (data ?? []) as ItemRow[];
  const taskIds = rows.map(r => r.task_id).filter((id): id is string => Boolean(id));
  const taskStatusMap = new Map<string, TaskStatus>();
  if (taskIds.length > 0) {
    const { data: taskData, error: taskError } = await client.from("tasks").select("id,status").in("id", taskIds);
    if (taskError) throw new Error("Could not load linked School tasks.");
    for (const t of (taskData ?? []) as { id: string; status: TaskStatus }[]) {
      taskStatusMap.set(t.id, t.status);
    }
  }
  return rows.map(row => ({
    id: row.id,
    courseId: row.course_id,
    itemType: row.item_type,
    title: row.title,
    dueDate: row.due_date,
    dueAt: row.due_at,
    sourceUrl: row.source_url,
    weight: row.weight,
    taskId: row.task_id,
    taskStatus: row.task_id ? taskStatusMap.get(row.task_id) ?? null : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listSchoolEmailEvents(): Promise<SchoolEmailEvent[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("school_email_events").select("id,status,item_id,received_at,parsed_event").eq("user_id", userId).order("received_at", { ascending: false }).limit(100);
  if (error) throw new Error("Could not load School email activity.");
  const rows = data ?? [];
  const itemIds = rows.map(row => row.item_id).filter((id): id is string => Boolean(id));
  const courseByItemId = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: itemData, error: itemError } = await client.from("school_items").select("id,course_id").in("id", itemIds);
    if (itemError) throw new Error("Could not load School activity courses.");
    for (const item of (itemData ?? []) as { id: string; course_id: string }[]) {
      courseByItemId.set(item.id, item.course_id);
    }
  }
  return rows.map(row => ({
    id: row.id,
    status: row.status,
    itemId: row.item_id,
    courseId: row.item_id ? courseByItemId.get(row.item_id) ?? null : null,
    receivedAt: row.received_at,
    parsedEvent: row.parsed_event,
  }));
}

export async function saveSchoolCourseMapping(sourceCourseKey: string, courseId: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.from("school_course_mappings").upsert({ user_id: userId, source_course_key: z.string().trim().min(1).max(500).parse(sourceCourseKey), course_id: z.uuid().parse(courseId) }, { onConflict: "user_id,source_course_key" });
  if (error) throw new Error("Could not save the School course mapping.");
}

export async function retrySchoolEmailEvent(id: string): Promise<SchoolIngestionResult> {
  const { client } = await requireAuthenticatedSupabase();
  const { data, error } = await client.rpc("retry_school_email_event", { p_id: z.uuid().parse(id) });
  if (error || !data) throw new Error("Could not retry the School email.");
  return data as SchoolIngestionResult;
}
