"use server";

import { revalidatePath } from "next/cache";
import {
  retrySchoolEmailEvent,
  saveSchoolCourseMapping,
} from "@/services/school/school-repository";

export type IntegrationActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function refresh() {
  revalidatePath("/integrations/blackboard");
  revalidatePath("/school");
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/");
}

export async function mapBlackboardEmailCourseAction(
  sourceCourseKey: unknown,
  courseId: unknown,
): Promise<IntegrationActionResult> {
  try {
    if (typeof sourceCourseKey !== "string" || !sourceCourseKey.trim()) {
      return { ok: false, message: "A valid source course key is required." };
    }
    if (typeof courseId !== "string" || !courseId.trim()) {
      return { ok: false, message: "A valid target course selection is required." };
    }

    await saveSchoolCourseMapping(sourceCourseKey.trim(), courseId.trim());
    refresh();
    return {
      ok: true,
      message: `Saved mapping for "${sourceCourseKey.trim()}". Future emails will resolve automatically.`,
    };
  } catch (error) {
    console.error("[blackboard-actions] save course mapping failed:", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to save course mapping.",
    };
  }
}

export async function retryBlackboardEmailAction(
  eventId: unknown,
): Promise<IntegrationActionResult> {
  try {
    if (typeof eventId !== "string" || !eventId.trim()) {
      return { ok: false, message: "A valid email event ID is required." };
    }

    const result = await retrySchoolEmailEvent(eventId.trim());
    refresh();
    return {
      ok: true,
      message: `Email event retried successfully: status is now "${result.status}".`,
    };
  } catch (error) {
    console.error("[blackboard-actions] retry email event failed:", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to retry email event.",
    };
  }
}
