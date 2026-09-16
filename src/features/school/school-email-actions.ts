"use server";

import { revalidatePath } from "next/cache";
import {
  listSchoolEmailEvents,
  retrySchoolEmailEvent,
  saveSchoolCourseMapping,
} from "@/services/school/school-repository";

export async function mapSchoolEmailCourseAction(sourceCourseKey: string, courseId: string) {
  try {
    await saveSchoolCourseMapping(sourceCourseKey, courseId);
    revalidatePath("/school");
    return { ok: true as const };
  } catch { return { ok: false as const, message: "Could not save the School mapping." }; }
}

export async function retrySchoolEmailAction(eventId: string) {
  try {
    const result = await retrySchoolEmailEvent(eventId);
    for (const path of ["/school", "/tasks", "/calendar", "/"]) revalidatePath(path);
    return { ok: true as const, result };
  } catch { return { ok: false as const, message: "Could not retry the School email." }; }
}

export async function loadSchoolEmailEventsAction() {
  try {
    return await listSchoolEmailEvents();
  } catch (error) {
    console.error("[school-email-actions] loadSchoolEmailEventsAction failed:", error);
    return [];
  }
}
