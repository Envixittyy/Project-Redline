import { NextResponse } from "next/server";

import { createNote, updateNote } from "@/services/notes/note-repository";
import { createTask, setTaskCompletion, updateTask } from "@/services/tasks/task-repository";
import { isTaskPriority, isTaskStatus, type TaskPatch } from "@/types/task";

export const runtime = "nodejs";
type Mutation = { id: unknown; kind: unknown; payload: unknown };
class InvalidMutation extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidMutation("The offline change is invalid.");
  return value as Record<string, unknown>;
}
function required(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || !value.trim()) throw new InvalidMutation(`${label} is required.`);
  if (value.trim().length > max) throw new InvalidMutation(`${label} is too long.`);
  return value.trim();
}
function optional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ message: "Invalid request origin." }, { status: 403 });

  try {
    const input = await request.json() as Mutation;
    const operationId = required(input.id, "The operation ID", 100);
    const payload = object(input.payload);

    switch (input.kind) {
      case "task_create": {
        const title = required(payload.title, "A task title");
        const dueDate = optional(payload.dueDate);
        if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new InvalidMutation("The due date is invalid.");
        const priority = isTaskPriority(payload.priority) ? payload.priority : "none";
        await createTask({ title, dueDate, priority, status: dueDate ? "todo" : "inbox", clientOperationId: operationId });
        break;
      }
      case "task_update": {
        const id = required(payload.id, "The task ID", 100);
        const patch = object(payload.patch);
        const allowed: TaskPatch = {};
        if (typeof patch.title === "string") allowed.title = required(patch.title, "A task title");
        if (typeof patch.description === "string" || patch.description === null)
          allowed.description = patch.description as string | null;
        if (isTaskStatus(patch.status)) allowed.status = patch.status;
        if (isTaskPriority(patch.priority)) allowed.priority = patch.priority;
        for (const key of ["dueDate", "dueAt", "scheduledStart", "scheduledEnd", "area", "project", "course"] as const) {
          const value = patch[key];
          if (typeof value === "string" || value === null) allowed[key] = value;
        }
        await updateTask(id, allowed);
        break;
      }
      case "task_status":
        await setTaskCompletion(required(payload.id, "The task ID", 100), payload.completed === true);
        break;
      case "note_create":
        await createNote({
          title: required(payload.title, "A note title"),
          body: typeof payload.body === "string" ? payload.body : "",
          taskId: optional(payload.taskId),
          courseId: optional(payload.courseId),
          operationId
        });
        break;
      case "note_update":
        await updateNote(required(payload.id, "The note ID", 100), {
          title: required(payload.title, "A note title"),
          body: typeof payload.body === "string" ? payload.body : "",
          taskId: optional(payload.taskId),
          courseId: optional(payload.courseId)
        });
        break;
      default:
        throw new InvalidMutation("That offline operation is not supported.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvalidMutation) return NextResponse.json({ message: error.message }, { status: 400 });
    console.error("[offline] replay failed:", error);
    const message =
      error instanceof Error && /no longer exists/i.test(error.message)
        ? error.message
        : "The change could not be synchronized.";
    return NextResponse.json({ message }, { status: /no longer exists/i.test(message) ? 409 : 500 });
  }
}
