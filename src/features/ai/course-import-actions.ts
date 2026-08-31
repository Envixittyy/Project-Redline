"use server";
import { revalidatePath } from "next/cache";
import {
  approveCourseImport,
  finalizeCourseImport,
  prepareCourseImport,
  readCourseImportReview,
  rejectCourseImport,
  reviseCourseImport,
} from "@/services/integrations/ai/course-import-repository";
import { AiTrustError } from "@/services/integrations/ai/trust-contract";
function failure(error: unknown) {
  return {
    ok: false as const,
    code:
      error instanceof AiTrustError ? error.code : "course_import_unavailable",
    message:
      "Course import unavailable. Check the document, pairing, expiry, and existing courses. Refresh the review before retrying.",
  };
}
export async function prepareCourseImportAction(
  form: FormData,
  provider: unknown,
  model: unknown,
) {
  try {
    return {
      ok: true as const,
      prepared: await prepareCourseImport(form, provider, model),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function finalizeCourseImportAction(
  requestId: unknown,
  raw: unknown,
) {
  try {
    return {
      ok: true as const,
      review: await finalizeCourseImport(requestId, raw),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function reviseCourseImportAction(
  batchId: unknown,
  edited: unknown,
) {
  try {
    return {
      ok: true as const,
      review: await reviseCourseImport(batchId, edited),
    };
  } catch (error) {
    return failure(error);
  }
}
export async function reviewCourseImportAction(batchId: unknown) {
  try {
    return { ok: true as const, review: await readCourseImportReview(batchId) };
  } catch (error) {
    return failure(error);
  }
}
export async function applyCourseImportAction(batchId: unknown) {
  try {
    const result = await approveCourseImport(batchId);
    for (const path of ["/school", "/calendar", "/"]) revalidatePath(path);
    return result.ok
      ? { ok: true as const }
      : {
          ok: false as const,
          message:
            "A course with this code already exists. Review your courses; nothing was added.",
        };
  } catch (error) {
    return failure(error);
  }
}
export async function rejectCourseImportAction(batchId: unknown) {
  try {
    await rejectCourseImport(batchId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}
