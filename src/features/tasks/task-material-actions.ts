"use server";

import { revalidatePath } from "next/cache";

import {
  linkTaskCourseMaterials,
  listCourseMaterials,
  listTaskCourseMaterials,
  unlinkTaskCourseMaterial,
} from "@/services/course-materials/course-material-repository";
import { authFailureMessage } from "@/services/supabase/errors";
import type { CourseMaterial, TaskCourseMaterialLink } from "@/types/course-material";

export type TaskMaterialActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

function failure(error: unknown): TaskMaterialActionResult {
  const auth = authFailureMessage(error);
  if (auth) return { ok: false, message: auth };
  console.error("[task-materials] action failed:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Task material link operation failed.",
  };
}

function refresh() {
  revalidatePath("/tasks");
  revalidatePath("/school");
  revalidatePath("/");
}

export async function getTaskMaterialsAction(
  taskId: unknown,
): Promise<{ ok: true; materials: TaskCourseMaterialLink[] } | { ok: false; message: string }> {
  try {
    if (typeof taskId !== "string" || !taskId.trim()) {
      return { ok: false, message: "Valid task ID required." };
    }
    const materials = await listTaskCourseMaterials(taskId.trim());
    return { ok: true, materials };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load task materials.",
    };
  }
}

export async function getCourseMaterialsForPickerAction(
  courseId: unknown,
): Promise<{ ok: true; materials: CourseMaterial[] } | { ok: false; message: string }> {
  try {
    if (typeof courseId !== "string" || !courseId.trim()) {
      return { ok: true, materials: [] };
    }
    const materials = await listCourseMaterials(courseId.trim());
    return { ok: true, materials };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load course materials for picker.",
    };
  }
}

export async function linkTaskMaterialsAction(
  taskId: unknown,
  materialIds: unknown,
): Promise<TaskMaterialActionResult> {
  try {
    if (typeof taskId !== "string" || !taskId.trim()) {
      return { ok: false, message: "Valid task ID required." };
    }
    if (!Array.isArray(materialIds) || materialIds.length === 0) {
      return { ok: false, message: "Please select at least one material to link." };
    }

    const validMaterialIds = materialIds.filter(
      (id): id is string => typeof id === "string" && Boolean(id.trim()),
    );

    await linkTaskCourseMaterials(taskId.trim(), validMaterialIds);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function unlinkTaskMaterialAction(
  taskId: unknown,
  materialId: unknown,
): Promise<TaskMaterialActionResult> {
  try {
    if (typeof taskId !== "string" || !taskId.trim()) {
      return { ok: false, message: "Valid task ID required." };
    }
    if (typeof materialId !== "string" || !materialId.trim()) {
      return { ok: false, message: "Valid material ID required." };
    }

    await unlinkTaskCourseMaterial(taskId.trim(), materialId.trim());
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

