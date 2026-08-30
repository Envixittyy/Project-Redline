import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type {
  CourseMaterial,
  CourseMaterialDraft,
  CourseMaterialType,
  TaskCourseMaterialLink,
} from "@/types/course-material";

type CourseMaterialRow = {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  type: CourseMaterialType;
  url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  courses?: { id: string; code: string; name: string; color: string | null } | Array<{ id: string; code: string; name: string; color: string | null }> | null;
};

type TaskCourseMaterialLinkRow = {
  id: string;
  task_id: string;
  course_material_id: string;
  created_at: string;
  course_materials: CourseMaterialRow | CourseMaterialRow[] | null;
};

export class CourseMaterialRepositoryError extends Error {
  constructor(message: string, readonly detail?: PostgrestError) {
    super(message);
    this.name = "CourseMaterialRepositoryError";
  }
}

function fail(action: string, error: PostgrestError): never {
  console.error(`[course-materials] ${action} failed: ${formatPostgrestErrorDiagnostic(error)}`);
  throw new CourseMaterialRepositoryError(`Could not ${action}. Please try again.`, error);
}

function toCourseMaterial(row: CourseMaterialRow): CourseMaterial {
  const courseObj = Array.isArray(row.courses) ? row.courses[0] : row.courses;
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    type: row.type,
    url: row.url,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    course: courseObj ?? null,
  };
}

export async function listCourseMaterials(courseId?: string): Promise<CourseMaterial[]> {
  const { client, userId } = await requireAuthenticatedSupabase();

  let query = client
    .from("course_materials")
    .select("id,user_id,course_id,title,type,url,description,created_at,updated_at,courses(id,code,name,color)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (courseId) {
    query = query.eq("course_id", courseId);
  }

  const { data, error } = await query;
  if (error) fail("load course materials", error);

  return ((data ?? []) as unknown as CourseMaterialRow[]).map(toCourseMaterial);
}

export async function getCourseMaterial(id: string): Promise<CourseMaterial | null> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("course_materials")
    .select("id,user_id,course_id,title,type,url,description,created_at,updated_at,courses(id,code,name,color)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) fail("load the course material", error);
  return data ? toCourseMaterial(data as unknown as CourseMaterialRow) : null;
}

export async function createCourseMaterial(draft: CourseMaterialDraft): Promise<CourseMaterial> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("course_materials")
    .insert({
      user_id: userId,
      course_id: draft.courseId,
      title: draft.title.trim(),
      type: draft.type,
      url: draft.url?.trim() || null,
      description: draft.description?.trim() || null,
    })
    .select("id,user_id,course_id,title,type,url,description,created_at,updated_at,courses(id,code,name,color)")
    .single();

  if (error) fail("create the course material", error);
  return toCourseMaterial(data as unknown as CourseMaterialRow);
}

export async function updateCourseMaterial(
  id: string,
  patch: Partial<CourseMaterialDraft>,
): Promise<CourseMaterial> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const updateData: Record<string, unknown> = {};

  if (patch.title !== undefined) updateData.title = patch.title.trim();
  if (patch.type !== undefined) updateData.type = patch.type;
  if (patch.url !== undefined) updateData.url = patch.url?.trim() || null;
  if (patch.description !== undefined) updateData.description = patch.description?.trim() || null;

  const { data, error } = await client
    .from("course_materials")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id,user_id,course_id,title,type,url,description,created_at,updated_at,courses(id,code,name,color)")
    .maybeSingle();

  if (error) fail("update the course material", error);
  if (!data) throw new CourseMaterialRepositoryError("That course material no longer exists.");

  return toCourseMaterial(data as unknown as CourseMaterialRow);
}

export async function deleteCourseMaterial(id: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("course_materials")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) fail("delete the course material", error);
  if (!data) throw new CourseMaterialRepositoryError("That course material no longer exists.");
}

export async function listTaskCourseMaterials(taskId: string): Promise<TaskCourseMaterialLink[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("task_course_material_links")
    .select("id,task_id,course_material_id,created_at,course_materials(id,user_id,course_id,title,type,url,description,created_at,updated_at,courses(id,code,name,color))")
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) fail("load task course materials", error);

  return ((data ?? []) as unknown as TaskCourseMaterialLinkRow[]).map((row) => {
    const materialObj = Array.isArray(row.course_materials)
      ? row.course_materials[0]
      : row.course_materials;

    return {
      id: row.id,
      taskId: row.task_id,
      courseMaterialId: row.course_material_id,
      createdAt: row.created_at,
      material: materialObj
        ? toCourseMaterial(materialObj)
        : {
            id: row.course_material_id,
            courseId: "",
            title: "Unknown material",
            type: "other",
            url: null,
            description: null,
            createdAt: row.created_at,
            updatedAt: row.created_at,
            course: null,
          },
    };
  });
}

export async function linkTaskCourseMaterials(
  taskId: string,
  materialIds: string[],
): Promise<void> {
  if (materialIds.length === 0) return;
  const { client, userId } = await requireAuthenticatedSupabase();

  const inserts = materialIds.map((materialId) => ({
    user_id: userId,
    task_id: taskId,
    course_material_id: materialId,
  }));

  const { error } = await client
    .from("task_course_material_links")
    .upsert(inserts, { onConflict: "user_id,task_id,course_material_id", ignoreDuplicates: true });

  if (error) fail("link course materials to task", error);
}

export async function unlinkTaskCourseMaterial(
  taskId: string,
  materialId: string,
): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client
    .from("task_course_material_links")
    .delete()
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .eq("course_material_id", materialId);

  if (error) fail("unlink course material from task", error);
}

