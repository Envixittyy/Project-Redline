import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { Note } from "@/types/note";

type NoteRow = { id:string; title:string; body:string; task_id:string|null; course_id:string|null; archived_at:string|null; created_at:string; updated_at:string };
const COLUMNS = "id,title,body,task_id,course_id,archived_at,created_at,updated_at";

export class NoteRepositoryError extends Error {
  constructor(message: string, readonly detail?: PostgrestError) { super(message); this.name = "NoteRepositoryError"; }
}
function fail(action: string, error: PostgrestError): never {
  console.error(`[notes] ${action} failed: ${formatPostgrestErrorDiagnostic(error)}`);
  throw new NoteRepositoryError(`Could not ${action}. Please try again.`, error);
}
function toNote(row: NoteRow): Note { return { id:row.id,title:row.title,body:row.body,taskId:row.task_id,courseId:row.course_id,archivedAt:row.archived_at,createdAt:row.created_at,updatedAt:row.updated_at }; }

export async function listNotes(search = ""): Promise<Note[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  let query = client.from("notes").select(COLUMNS).eq("user_id", userId).is("archived_at", null).order("updated_at", { ascending: false });
  const term = search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_");
  if (term) query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  const { data, error } = await query.limit(200);
  if (error) fail("load notes", error);
  return (data as NoteRow[]).map(toNote);
}

export type NoteDraft = { title:string; body:string; taskId:string|null; courseId:string|null; operationId?:string|null };
export async function createNote(draft: NoteDraft): Promise<Note> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("notes").upsert({ user_id:userId,title:draft.title,body:draft.body,task_id:draft.taskId,course_id:draft.courseId,client_operation_id:draft.operationId ?? null }, { onConflict:"user_id,client_operation_id", ignoreDuplicates:false }).select(COLUMNS).single();
  if (error) fail("create the note", error);
  return toNote(data as NoteRow);
}

export async function updateNote(id: string, draft: Omit<NoteDraft,"operationId">): Promise<Note> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("notes").update({ title:draft.title,body:draft.body,task_id:draft.taskId,course_id:draft.courseId }).eq("id", id).eq("user_id", userId).select(COLUMNS).maybeSingle();
  if (error) fail("save the note", error);
  if (!data) throw new NoteRepositoryError("That note no longer exists.");
  return toNote(data as NoteRow);
}

export async function archiveNote(id: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("notes").update({ archived_at:new Date().toISOString() }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) fail("archive the note", error);
  if (!data) throw new NoteRepositoryError("That note no longer exists.");
}

export async function readNote(id:string):Promise<Note>{
  const {client,userId}=await requireAuthenticatedSupabase();const {data,error}=await client.from("notes").select(COLUMNS).eq("id",id).eq("user_id",userId).is("archived_at",null).maybeSingle();
  if(error||!data)throw new NoteRepositoryError("The saved note is unavailable.");return toNote(data);
}
