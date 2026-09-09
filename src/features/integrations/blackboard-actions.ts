"use server";

import { revalidatePath } from "next/cache";

import {
  assignCourseToBlackboardRecords,
  deleteBlackboardCourseMapping,
  saveBlackboardCourseMapping,
} from "@/services/integrations/blackboard/blackboard-mapping-repository";
import {
  characterizeConfiguredBlackboardFeed,
  configureBlackboardFeed,
  runBlackboardSync,
} from "@/services/integrations/blackboard/blackboard-repository";
import type { BlackboardCalendarCharacterization } from "@/services/integrations/blackboard/characterization";
import { BlackboardCalendarParseError } from "@/services/integrations/blackboard/ical";
import { BlackboardFetchError } from "@/services/integrations/blackboard/safe-fetch";
import {
  BlackboardUrlError,
  validateFeedUrl,
} from "@/services/integrations/blackboard/safe-url";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

export type IntegrationActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type BlackboardCharacterizationActionResult =
  | { ok: true; message: string; report: BlackboardCalendarCharacterization }
  | { ok: false; message: string; report?: never };

function refresh() {
  revalidatePath("/integrations/blackboard");
  revalidatePath("/tasks");
  revalidatePath("/school");
  revalidatePath("/calendar");
  revalidatePath("/inbox");
  revalidatePath("/");
}

function safeDiagnostic(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      error instanceof BlackboardFetchError ||
      error instanceof BlackboardUrlError ||
      error instanceof BlackboardCalendarParseError
        ? error.code
        : "unknown",
    message: error instanceof Error ? error.message : "Unknown Blackboard error",
  };
}

function syncFailureMessage(error: unknown): string {
  if (error instanceof BlackboardUrlError) return error.message;
  if (error instanceof BlackboardCalendarParseError) return error.message;
  if (!(error instanceof BlackboardFetchError)) {
    return "Blackboard sync failed safely. Review Sync health and try again.";
  }

  switch (error.code) {
    case "unsafe_dns":
      return "Blackboard sync stopped because the feed resolved to a private, malformed, or reserved network address.";
    case "dns_failed":
      return "The Blackboard feed host could not be resolved. Check the URL or try again later.";
    case "timeout":
      return "Blackboard did not respond before the secure connection timed out.";
    case "response_too_large":
    case "partial_response":
    case "redirect":
    case "content_type":
    case "invalid_calendar":
    case "http_status":
      return error.message;
    default:
      return "Blackboard could not be reached securely. Try again later.";
  }
}

export async function configureBlackboardAction(
  feedUrl: unknown,
): Promise<IntegrationActionResult> {
  try {
    if (typeof feedUrl !== "string") {
      throw new BlackboardUrlError("invalid_url", "Enter your private Blackboard calendar URL.");
    }

    const url = validateFeedUrl(feedUrl);
    await configureBlackboardFeed(url.toString());
    refresh();
    return {
      ok: true,
      message: "Blackboard calendar connected in observe mode. The credential is encrypted and will not be shown again.",
    };
  } catch (error) {
    console.error("[blackboard] configuration failed:", safeDiagnostic(error));
    return {
      ok: false,
      message: syncFailureMessage(error),
    };
  }
}

export async function syncBlackboardAction(): Promise<IntegrationActionResult> {
  try {
    const result = await runBlackboardSync();
    refresh();
    const unresolvedMsg = result.unresolved > 0 ? ` (${result.unresolved} unresolved to review)` : "";
    const modeMessage = result.mode === "observe"
      ? "Observe-only sync complete; no School or Task records were changed"
      : `Apply sync complete: ${result.applied} canonical change${result.applied === 1 ? "" : "s"} applied`;
    return {
      ok: true,
      message: `${modeMessage}. ${result.created} new observations, ${result.updated} updated, ${result.missing} missing-source${unresolvedMsg}.`,
    };
  } catch (error) {
    console.error("[blackboard] sync failed:", safeDiagnostic(error));
    return { ok: false, message: syncFailureMessage(error) };
  }
}

export async function characterizeBlackboardAction(): Promise<BlackboardCharacterizationActionResult> {
  try {
    const report = await characterizeConfiguredBlackboardFeed();
    return {
      ok: true,
      message: `Redacted characterization complete for ${report.calendar.eventCount} event${report.calendar.eventCount === 1 ? "" : "s"}.`,
      report,
    };
  } catch (error) {
    console.error("[blackboard] characterization failed:", safeDiagnostic(error));
    return { ok: false, message: syncFailureMessage(error) };
  }
}

export async function saveCourseMappingAction(
  sourceCourseName: unknown,
  courseId: unknown,
): Promise<IntegrationActionResult> {
  try {
    if (typeof sourceCourseName !== "string" || !sourceCourseName.trim()) {
      return { ok: false, message: "A valid source course name is required." };
    }
    if (typeof courseId !== "string" || !courseId.trim()) {
      return { ok: false, message: "A valid Redline course selection is required." };
    }

    const { client, userId } = await requireAuthenticatedSupabase();
    const account = await client
      .from("integration_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "blackboard")
      .single();

    if (account.error || !account.data) {
      return { ok: false, message: "Blackboard integration account not found." };
    }

    await saveBlackboardCourseMapping(
      account.data.id,
      sourceCourseName.trim(),
      courseId.trim(),
    );

    refresh();
    return {
      ok: true,
      message: `Saved mapping for "${sourceCourseName.trim()}". Future items will resolve automatically.`,
    };
  } catch (error) {
    console.error("[blackboard] save mapping failed:", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to save course mapping.",
    };
  }
}

export async function deleteCourseMappingAction(
  mappingId: unknown,
): Promise<IntegrationActionResult> {
  try {
    if (typeof mappingId !== "string" || !mappingId.trim()) {
      return { ok: false, message: "A valid mapping ID is required." };
    }

    await deleteBlackboardCourseMapping(mappingId.trim());
    refresh();
    return {
      ok: true,
      message: "Course mapping removed.",
    };
  } catch (error) {
    console.error("[blackboard] delete mapping failed:", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to remove course mapping.",
    };
  }
}

export async function assignBlackboardRecordsAction(
  recordIds: unknown,
  courseId: unknown,
  rememberMapping = true,
): Promise<IntegrationActionResult> {
  try {
    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      return { ok: false, message: "Please select at least one item to assign." };
    }
    if (typeof courseId !== "string" || !courseId.trim()) {
      return { ok: false, message: "Please select a target course." };
    }

    const validRecordIds = recordIds.filter(
      (id): id is string => typeof id === "string" && Boolean(id.trim()),
    );

    const result = await assignCourseToBlackboardRecords(
      validRecordIds,
      courseId.trim(),
      Boolean(rememberMapping),
    );

    refresh();
    const rememberMsg = rememberMapping ? " and remembered association" : "";
    return {
      ok: true,
      message: `Assigned ${result.assignedCount} item${result.assignedCount === 1 ? "" : "s"} to course${rememberMsg}.`,
    };
  } catch (error) {
    console.error("[blackboard] assign records failed:", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to assign course to items.",
    };
  }
}
