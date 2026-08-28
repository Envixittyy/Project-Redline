"use server";

import { revalidatePath } from "next/cache";

import {
  configureBlackboardFeed,
  runBlackboardSync,
} from "@/services/integrations/blackboard/blackboard-repository";
import { BlackboardFetchError } from "@/services/integrations/blackboard/safe-fetch";
import {
  BlackboardUrlError,
  validateFeedUrl,
} from "@/services/integrations/blackboard/safe-url";

export type IntegrationActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function refresh() {
  revalidatePath("/integrations/blackboard");
  revalidatePath("/tasks");
  revalidatePath("/");
}

function safeDiagnostic(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      error instanceof BlackboardFetchError || error instanceof BlackboardUrlError
        ? error.code
        : "unknown",
    message: error instanceof Error ? error.message : "Unknown Blackboard error",
  };
}

function syncFailureMessage(error: unknown): string {
  if (error instanceof BlackboardUrlError) return error.message;
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
      message: "Blackboard calendar connected. The credential is encrypted and will not be shown again.",
    };
  } catch (error) {
    console.error("[blackboard] configuration failed:", safeDiagnostic(error));
    return {
      ok: false,
      message: error instanceof BlackboardUrlError ? error.message : "Blackboard could not be connected.",
    };
  }
}

export async function syncBlackboardAction(): Promise<IntegrationActionResult> {
  try {
    const result = await runBlackboardSync();
    refresh();
    return {
      ok: true,
      message: `Sync complete: ${result.created} new, ${result.updated} updated, ${result.missing} missing-source.`,
    };
  } catch (error) {
    console.error("[blackboard] sync failed:", safeDiagnostic(error));
    return { ok: false, message: syncFailureMessage(error) };
  }
}
