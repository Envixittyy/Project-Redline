"use server";

import { revalidatePath } from "next/cache";

import { isIsoDate } from "@/lib/date/day";
import {
  createTask,
  deleteTask,
  setTaskCompletion,
  updateTask,
} from "@/services/tasks/task-repository";
import { SupabaseNotConfiguredError } from "@/services/supabase/server";
import {
  isTaskPriority,
  isTaskStatus,
  type TaskPatch,
  type TaskPriority,
} from "@/types/task";

export type ActionResult = { ok: true } | { ok: false; message: string };

const TASKS_PATH = "/tasks";
const CALENDAR_PATH = "/calendar";

function revalidateTaskConsumers() {
  revalidatePath(TASKS_PATH);
  revalidatePath(CALENDAR_PATH);
}

class InvalidInputError extends Error {}

function requireTitle(value: unknown): string {
  if (typeof value !== "string") throw new InvalidInputError("A title is required.");

  const title = value.trim();
  if (title === "") throw new InvalidInputError("A title is required.");
  if (title.length > 200) throw new InvalidInputError("Titles are limited to 200 characters.");

  return title;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidInputError(`${field} must be text.`);

  const text = value.trim();
  return text === "" ? null : text;
}

function optionalDate(value: unknown): string | null {
  const text = optionalText(value, "The due date");
  if (text === null) return null;
  if (!isIsoDate(text)) throw new InvalidInputError("That due date is not a valid date.");

  return text;
}

function optionalInstant(value: unknown, field: string): string | null {
  const text = optionalText(value, field);
  if (text === null) return null;

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new InvalidInputError(`${field} is not a valid time.`);

  return new Date(parsed).toISOString();
}

function optionalPriority(value: unknown): TaskPriority | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isTaskPriority(value)) throw new InvalidInputError("That priority is not recognised.");

  return value;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInputError("That task could not be identified.");
  }

  return value;
}

/** Translate any thrown error into a message the interface can show. */
function toFailure(error: unknown): ActionResult {
  if (error instanceof InvalidInputError) {
    return { ok: false, message: error.message };
  }

  if (error instanceof SupabaseNotConfiguredError) {
    return { ok: false, message: "Supabase is not configured, so tasks cannot be saved yet." };
  }

  console.error("[tasks] action failed:", error);

  return {
    ok: false,
    message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
  };
}

export type QuickAddInput = {
  title: string;
  dueDate?: string | null;
  priority?: string | null;
};

/**
 * Quick add deliberately captures only a title, an optional due date, and an
 * optional priority. Everything else is set in the fuller editor.
 */
export async function createTaskAction(input: QuickAddInput): Promise<ActionResult> {
  try {
    const dueDate = optionalDate(input?.dueDate);

    await createTask({
      title: requireTitle(input?.title),
      dueDate,
      priority: optionalPriority(input?.priority) ?? "none",
      // A dated task is ready to work on; an undated one waits in the inbox.
      status: dueDate ? "todo" : "inbox",
    });

    revalidateTaskConsumers();

    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export type TaskEditInput = {
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  area?: string | null;
  project?: string | null;
  course?: string | null;
};

export async function saveTaskAction(id: unknown, input: TaskEditInput): Promise<ActionResult> {
  try {
    const taskId = requireId(id);

    const status = input?.status;
    if (status !== undefined && status !== null && status !== "" && !isTaskStatus(status)) {
      throw new InvalidInputError("That status is not recognised.");
    }
    if (status === "completed") {
      // Completion is handled by its own action so the timestamp stays correct.
      throw new InvalidInputError("Use the complete control to finish a task.");
    }

    const scheduledStart = optionalInstant(input?.scheduledStart, "The scheduled start");
    const scheduledEnd = optionalInstant(input?.scheduledEnd, "The scheduled end");

    if (scheduledEnd && !scheduledStart) {
      throw new InvalidInputError("A scheduled end needs a scheduled start.");
    }
    if (scheduledStart && scheduledEnd && Date.parse(scheduledEnd) < Date.parse(scheduledStart)) {
      throw new InvalidInputError("The scheduled end cannot be before the scheduled start.");
    }

    const patch: TaskPatch = {
      title: requireTitle(input?.title),
      description: optionalText(input?.description, "The description"),
      priority: optionalPriority(input?.priority) ?? "none",
      dueDate: optionalDate(input?.dueDate),
      scheduledStart,
      scheduledEnd,
      area: optionalText(input?.area, "The area"),
      project: optionalText(input?.project, "The project"),
      course: optionalText(input?.course, "The course"),
    };

    if (status) patch.status = status;

    await updateTask(taskId, patch);
    revalidateTaskConsumers();

    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function setTaskCompletionAction(
  id: unknown,
  completed: unknown,
): Promise<ActionResult> {
  try {
    await setTaskCompletion(requireId(id), completed === true);
    revalidateTaskConsumers();

    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteTaskAction(id: unknown): Promise<ActionResult> {
  try {
    await deleteTask(requireId(id));
    revalidateTaskConsumers();

    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
