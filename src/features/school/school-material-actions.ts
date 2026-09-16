"use server";

import { revalidatePath } from "next/cache";

import {
  createCourseMaterial,
  deleteCourseMaterial,
  listCourseMaterials,
  updateCourseMaterial,
} from "@/services/course-materials/course-material-repository";
import { authFailureMessage } from "@/services/supabase/errors";
import { isCourseMaterialType, type CourseMaterialType } from "@/types/course-material";

export type SchoolMaterialActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

class InvalidMaterialInput extends Error {}

function requireText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidMaterialInput(`${label} is required.`);
  }
  if (value.trim().length > max) {
    throw new InvalidMaterialInput(`${label} is too long (max ${max} characters).`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

function failure(error: unknown): SchoolMaterialActionResult {
  if (error instanceof InvalidMaterialInput) return { ok: false, message: error.message };
  const auth = authFailureMessage(error);
  if (auth) return { ok: false, message: auth };
  console.error("[school-materials] action failed:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Material could not be updated.",
  };
}

function refresh() {
  revalidatePath("/school");
  revalidatePath("/tasks");
  revalidatePath("/");
}

export type MaterialInput = {
  title: string;
  type: string;
  url?: string | null;
  description?: string | null;
};

export async function saveCourseMaterialAction(
  courseId: unknown,
  materialId: unknown,
  input: MaterialInput,
): Promise<SchoolMaterialActionResult> {
  try {
    const validCourseId = requireText(courseId, "Course ID", 100);
    const title = requireText(input?.title, "Material title", 200);

    const typeStr = input?.type;
    if (!isCourseMaterialType(typeStr)) {
      throw new InvalidMaterialInput("Choose a valid material type.");
    }
    const type: CourseMaterialType = typeStr;

    const url = optionalText(input?.url);
    const description = optionalText(input?.description);

    if (materialId && typeof materialId === "string" && materialId.trim()) {
      await updateCourseMaterial(materialId.trim(), {
        title,
        type,
        url,
        description,
      });
    } else {
      await createCourseMaterial({
        courseId: validCourseId,
        title,
        type,
        url,
        description,
      });
    }

    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteCourseMaterialAction(
  materialId: unknown,
): Promise<SchoolMaterialActionResult> {
  try {
    const validId = requireText(materialId, "Material ID", 100);
    await deleteCourseMaterial(validId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function loadCourseMaterialsAction(courseId?: string) {
  try {
    return await listCourseMaterials(courseId);
  } catch (error) {
    console.error("[school-materials] loadCourseMaterialsAction failed:", error);
    return [];
  }
}

