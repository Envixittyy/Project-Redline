"use server";

import { revalidatePath } from "next/cache";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/services/calendar-events/calendar-event-repository";
import { SupabaseNotConfiguredError } from "@/services/supabase/server";
import { isNativeCalendarEventType, type CalendarEventDraft } from "@/types/calendar-event";

export type CalendarActionResult = { ok: true } | { ok: false; message: string };

export type CalendarEventInput = {
  title: string;
  description?: string | null;
  start: string;
  end: string;
  allDay?: boolean;
  eventType?: string | null;
  course?: string | null;
};

class InvalidCalendarInputError extends Error {}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidCalendarInputError("That event could not be identified.");
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidCalendarInputError(`${field} must be text.`);
  const text = value.trim();
  return text === "" ? null : text;
}

function validatedDraft(input: CalendarEventInput): CalendarEventDraft {
  if (typeof input?.title !== "string" || input.title.trim() === "") {
    throw new InvalidCalendarInputError("Give the event a title.");
  }

  const title = input.title.trim();
  if (title.length > 200) throw new InvalidCalendarInputError("Titles are limited to 200 characters.");

  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new InvalidCalendarInputError("Choose valid start and end times.");
  }
  if (end <= start) throw new InvalidCalendarInputError("The event must end after it starts.");

  const eventType = input.eventType ?? "event";
  if (!isNativeCalendarEventType(eventType)) {
    throw new InvalidCalendarInputError("That event type is not recognised.");
  }

  return {
    title,
    description: optionalText(input.description, "The description"),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    allDay: input.allDay === true,
    eventType,
    source: "life_os",
    externalId: null,
    sourceUrl: null,
    course: optionalText(input.course, "The course"),
  };
}

function toFailure(error: unknown): CalendarActionResult {
  if (error instanceof InvalidCalendarInputError) return { ok: false, message: error.message };
  if (error instanceof SupabaseNotConfiguredError) {
    return { ok: false, message: "Supabase is not configured, so events cannot be saved yet." };
  }

  console.error("[calendar] action failed:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
  };
}

export async function createCalendarEventAction(input: CalendarEventInput): Promise<CalendarActionResult> {
  try {
    await createCalendarEvent(validatedDraft(input));
    revalidatePath("/calendar");
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function saveCalendarEventAction(
  id: unknown,
  input: CalendarEventInput,
): Promise<CalendarActionResult> {
  try {
    await updateCalendarEvent(requireId(id), validatedDraft(input));
    revalidatePath("/calendar");
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteCalendarEventAction(id: unknown): Promise<CalendarActionResult> {
  try {
    await deleteCalendarEvent(requireId(id));
    revalidatePath("/calendar");
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
