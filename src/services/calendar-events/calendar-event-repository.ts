import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarEventSource,
} from "@/types/calendar-event";

const TABLE = "calendar_events";
const COLUMNS =
  "id, title, description, starts_at, ends_at, all_day, event_type, source, external_id, source_url, course, created_at, updated_at";

type CalendarEventRow = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  event_type: string;
  source: CalendarEventSource;
  external_id: string | null;
  source_url: string | null;
  course: string | null;
  created_at: string;
  updated_at: string;
};

export class CalendarEventRepositoryError extends Error {
  readonly detail?: PostgrestError;

  constructor(message: string, detail?: PostgrestError) {
    super(message);
    this.name = "CalendarEventRepositoryError";
    this.detail = detail;
  }
}

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    start: row.starts_at,
    end: row.ends_at,
    allDay: row.all_day,
    eventType: row.event_type,
    source: row.source,
    externalId: row.external_id,
    sourceUrl: row.source_url,
    course: row.course,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(draft: CalendarEventDraft | CalendarEventPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (draft.title !== undefined) row.title = draft.title.trim();
  if (draft.description !== undefined) row.description = emptyToNull(draft.description);
  if (draft.start !== undefined) row.starts_at = draft.start;
  if (draft.end !== undefined) row.ends_at = draft.end;
  if (draft.allDay !== undefined) row.all_day = draft.allDay;
  if (draft.eventType !== undefined) row.event_type = draft.eventType.trim();
  if (draft.source !== undefined) row.source = draft.source;
  if (draft.externalId !== undefined) row.external_id = emptyToNull(draft.externalId);
  if (draft.sourceUrl !== undefined) row.source_url = emptyToNull(draft.sourceUrl);
  if (draft.course !== undefined) row.course = emptyToNull(draft.course);

  return row;
}

function fail(action: string, error: PostgrestError): never {
  console.error("[calendar-events] " + action + " failed:", error);
  throw new CalendarEventRepositoryError("Could not " + action + ". Please try again.", error);
}

/** Events overlapping the half-open instant range `[start, end)`. */
export async function listCalendarEventsInRange(start: string, end: string): Promise<CalendarEvent[]> {
  const { client: supabase, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", userId)
    .lt("starts_at", end)
    .gt("ends_at", start)
    .order("starts_at", { ascending: true })
    .limit(500);

  if (error) fail("load calendar events", error);
  return (data as CalendarEventRow[]).map(toCalendarEvent);
}

export async function createCalendarEvent(draft: CalendarEventDraft): Promise<CalendarEvent> {
  const { client: supabase, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...toRow(draft), user_id: userId })
    .select(COLUMNS)
    .single();

  if (error) fail("create the event", error);
  return toCalendarEvent(data as CalendarEventRow);
}

export async function updateCalendarEvent(
  id: string,
  patch: CalendarEventPatch,
): Promise<CalendarEvent> {
  const { client: supabase, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(patch))
    .eq("id", id)
    .eq("user_id", userId)
    // External events are read-only until their integration phase.
    .eq("source", "life_os")
    .select(COLUMNS)
    .maybeSingle();

  if (error) fail("update the event", error);
  if (!data) throw new CalendarEventRepositoryError("That event no longer exists or is read-only.");

  return toCalendarEvent(data as CalendarEventRow);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { client: supabase, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("source", "life_os")
    .select("id")
    .maybeSingle();

  if (error) fail("delete the event", error);
  if (!data) throw new CalendarEventRepositoryError("That event no longer exists or is read-only.");
}
