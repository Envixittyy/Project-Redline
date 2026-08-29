"use server";

import { revalidatePath } from "next/cache";

import { isIsoInstant } from "@/lib/date/day";
import { authFailureMessage, SupabaseNotConfiguredError } from "@/services/supabase/errors";
import {
  createWorkSession,
  deleteWorkSession,
  updateWorkSession,
} from "@/services/work-sessions/work-session-repository";
import type { WorkSessionDraft } from "@/types/work-session";

export type WorkSessionActionResult = { ok: true } | { ok: false; message: string };
export type WorkSessionInput = { taskId: string; startsAt: string; endsAt: string };

class InvalidWorkSessionInputError extends Error {}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidWorkSessionInputError(`${label} could not be identified.`);
  }
  return value;
}

function validatedDraft(input: WorkSessionInput): WorkSessionDraft {
  const taskId = requireId(input?.taskId, "The task");
  if (!isIsoInstant(input?.startsAt) || !isIsoInstant(input?.endsAt)) {
    throw new InvalidWorkSessionInputError("Choose valid start and end times.");
  }
  const startsAt = new Date(input.startsAt).toISOString();
  const endsAt = new Date(input.endsAt).toISOString();
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new InvalidWorkSessionInputError("The work session must end after it starts.");
  }
  return { taskId, startsAt, endsAt, source: "manual" };
}

function revalidateWorkSessionConsumers() {
  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/");
}

function toFailure(error: unknown): WorkSessionActionResult {
  if (error instanceof InvalidWorkSessionInputError) return { ok: false, message: error.message };
  if (error instanceof SupabaseNotConfiguredError) {
    return { ok: false, message: "Supabase is not configured, so work sessions cannot be saved yet." };
  }
  const authMessage = authFailureMessage(error);
  if (authMessage) return { ok: false, message: authMessage };
  console.error("[work-sessions] action failed:", error);
  return { ok: false, message: error instanceof Error ? error.message : "Something went wrong. Please try again." };
}

export async function createWorkSessionAction(input: WorkSessionInput): Promise<WorkSessionActionResult> {
  try {
    await createWorkSession(validatedDraft(input));
    revalidateWorkSessionConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function saveWorkSessionAction(id: unknown, input: WorkSessionInput): Promise<WorkSessionActionResult> {
  try {
    await updateWorkSession(requireId(id, "The work session"), validatedDraft(input));
    revalidateWorkSessionConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteWorkSessionAction(id: unknown): Promise<WorkSessionActionResult> {
  try {
    await deleteWorkSession(requireId(id, "The work session"));
    revalidateWorkSessionConsumers();
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
