"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  GoogleCalendarRefreshInProgressError,
  runGoogleCalendarSync,
} from "@/services/integrations/calendar/google-calendar-sync";

export async function syncGoogleCalendarAction(): Promise<void> {
  let outcome = "failed";
  try {
    const result = await runGoogleCalendarSync();
    outcome = `complete:${result.calendars}:${result.events}:${result.cancelled}:${result.missing}`;
    revalidatePath("/integrations/calendars");
    revalidatePath("/calendar");
  } catch (error) {
    console.error("[google-calendar] sync failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof GoogleCalendarRefreshInProgressError) outcome = "busy";
  }
  redirect(`/integrations/calendars?googleSync=${encodeURIComponent(outcome)}`);
}
