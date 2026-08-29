import "server-only";

import { createHash } from "node:crypto";

import { addDays, dayRangeIn, resolveTimeZone, todayIn } from "@/lib/date/day";
import { decryptCredential, encryptCredential } from "@/services/integrations/credential";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";

import { GoogleCalendarApiError, GoogleCalendarProvider } from "./google-provider";
import {
  parseGoogleTokenCredential,
  refreshGoogleTokenCredential,
} from "./google-oauth";
import {
  hasCalendarCapabilities,
  requireCalendarCapability,
  type CalendarProviderCapability,
  type ExternalCalendarEvent,
} from "./provider-contract";

const ACCESS_TOKEN_BUFFER_MS = 2 * 60 * 1000;
const REFRESH_LEASE_MS = 60 * 1000;
const WRITE_BATCH_SIZE = 200;

type AuthenticatedClient = Awaited<ReturnType<typeof requireAuthenticatedSupabase>>["client"];

type GoogleAccountRow = {
  id: string;
  encrypted_credential: string;
  token_expires_at: string | null;
  capabilities: CalendarProviderCapability[];
};

type RefreshClaimRow = {
  encrypted_credential: string;
  token_expires_at: string | null;
};

type CalendarRow = {
  id: string;
  external_calendar_id: string;
  selected: boolean;
  encrypted_sync_token: string | null;
};

export type GoogleCalendarSyncResult = {
  calendars: number;
  events: number;
  cancelled: number;
  missing: number;
};

export class GoogleCalendarRefreshInProgressError extends Error {
  constructor() {
    super("Google Calendar credentials are already being refreshed. Try again in a moment.");
    this.name = "GoogleCalendarRefreshInProgressError";
  }
}

function batches<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += WRITE_BATCH_SIZE) {
    result.push(values.slice(index, index + WRITE_BATCH_SIZE));
  }
  return result;
}

function contentHash(event: ExternalCalendarEvent): string {
  return createHash("sha256").update(JSON.stringify({
    revision: event.revision,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    status: event.status,
  })).digest("hex");
}

async function googleAccount(
  client: AuthenticatedClient,
  userId: string,
): Promise<GoogleAccountRow> {
  const result = await client
    .from("external_calendar_accounts")
    .select("id,encrypted_credential,token_expires_at,capabilities")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("status", "connected")
    .single();
  if (result.error || !result.data?.encrypted_credential) {
    throw new Error("Connect Google Calendar before synchronizing.");
  }
  const account = result.data as GoogleAccountRow;
  if (!hasCalendarCapabilities(account.capabilities, ["list_calendars", "list_events"])) {
    throw new Error("The Google Calendar connection does not permit event synchronization.");
  }
  return account;
}

async function accessToken(
  client: AuthenticatedClient,
  account: GoogleAccountRow,
): Promise<string> {
  const current = parseGoogleTokenCredential(account.encrypted_credential);
  if (Date.parse(current.expiresAt) > Date.now() + ACCESS_TOKEN_BUFFER_MS) {
    return current.accessToken;
  }

  const lockUntil = new Date(Date.now() + REFRESH_LEASE_MS).toISOString();
  const claim = await client.rpc("claim_google_calendar_refresh", {
    target_account_id: account.id,
    new_lock_until: lockUntil,
  });
  if (claim.error) throw claim.error;
  const claimed = (claim.data as RefreshClaimRow[] | null)?.[0];
  if (!claimed) throw new GoogleCalendarRefreshInProgressError();

  try {
    const credential = parseGoogleTokenCredential(claimed.encrypted_credential);
    const refreshed = await refreshGoogleTokenCredential(credential);
    const finish = await client.rpc("finish_google_calendar_refresh", {
      target_account_id: account.id,
      expected_lock_until: lockUntil,
      new_encrypted_credential: refreshed.encryptedCredential,
      new_token_expires_at: refreshed.expiresAt,
    });
    if (finish.error || finish.data !== true) {
      throw finish.error ?? new Error("The Google Calendar credential refresh lease expired.");
    }
    return refreshed.credential.accessToken;
  } catch (error) {
    await client.rpc("fail_google_calendar_refresh", {
      target_account_id: account.id,
      expected_lock_until: lockUntil,
      safe_error_code: "google_refresh_failed",
    });
    throw error;
  }
}

async function upsertCalendars(
  client: AuthenticatedClient,
  userId: string,
  accountId: string,
  calendars: Awaited<ReturnType<GoogleCalendarProvider["listCalendars"]>>,
): Promise<CalendarRow[]> {
  if (calendars.length === 0) return [];
  const result = await client.from("external_calendars").upsert(
    calendars.map((calendar) => ({
      user_id: userId,
      account_id: accountId,
      external_calendar_id: calendar.externalCalendarId,
      name: calendar.name,
      access: calendar.access,
    })),
    { onConflict: "account_id,external_calendar_id" },
  ).select("id,external_calendar_id,selected,encrypted_sync_token");
  if (result.error) throw result.error;
  return (result.data ?? []) as CalendarRow[];
}

async function upsertEvents(
  client: AuthenticatedClient,
  userId: string,
  calendarId: string,
  events: readonly ExternalCalendarEvent[],
): Promise<void> {
  for (const batch of batches(events)) {
    const result = await client.from("external_calendar_events").upsert(
      batch.map((event) => ({
        user_id: userId,
        calendar_id: calendarId,
        external_event_id: event.externalEventId,
        revision: event.revision,
        title: event.title,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        all_day: event.allDay,
        status: event.status,
        content_hash: contentHash(event),
        missing_since: null,
      })),
      { onConflict: "calendar_id,external_event_id" },
    );
    if (result.error) throw result.error;
  }
}

async function cancelEvents(
  client: AuthenticatedClient,
  userId: string,
  calendarId: string,
  externalEventIds: readonly string[],
): Promise<void> {
  for (const batch of batches([...new Set(externalEventIds)])) {
    const result = await client
      .from("external_calendar_events")
      .update({ status: "cancelled", missing_since: null })
      .eq("user_id", userId)
      .eq("calendar_id", calendarId)
      .in("external_event_id", batch);
    if (result.error) throw result.error;
  }
}

async function markMissing(
  client: AuthenticatedClient,
  userId: string,
  calendarId: string,
  startsAt: string,
  endsAt: string,
  seen: ReadonlySet<string>,
): Promise<number> {
  const missingIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await client
      .from("external_calendar_events")
      .select("id,external_event_id")
      .eq("user_id", userId)
      .eq("calendar_id", calendarId)
      .neq("status", "cancelled")
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt)
      .range(from, from + 999);
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as Array<{ id: string; external_event_id: string }>;
    missingIds.push(...rows.filter((row) => !seen.has(row.external_event_id)).map((row) => row.id));
    if (rows.length < 1000) break;
  }
  const missingSince = new Date().toISOString();
  for (const batch of batches(missingIds)) {
    const result = await client
      .from("external_calendar_events")
      .update({ missing_since: missingSince })
      .eq("user_id", userId)
      .eq("calendar_id", calendarId)
      .in("id", batch);
    if (result.error) throw result.error;
  }
  return missingIds.length;
}

async function syncCalendar(
  client: AuthenticatedClient,
  userId: string,
  provider: GoogleCalendarProvider,
  calendar: CalendarRow,
  startsAt: string,
  endsAt: string,
  timeZone: string,
  encryptedSyncToken: string | null,
): Promise<Omit<GoogleCalendarSyncResult, "calendars">> {
  const seen = new Set<string>();
  let events = 0;
  let cancelled = 0;
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let syncToken = encryptedSyncToken ? decryptCredential(encryptedSyncToken) : undefined;

  const readAllPages = async () => {
    do {
      const page = await provider.listEvents({
        externalCalendarId: calendar.external_calendar_id,
        startsAt,
        endsAt,
        timeZone,
        pageToken,
        syncToken,
      });
      await upsertEvents(client, userId, calendar.id, page.events);
      await cancelEvents(client, userId, calendar.id, page.deletedExternalEventIds);
      page.events.forEach((event) => seen.add(event.externalEventId));
      events += page.events.length;
      cancelled += page.deletedExternalEventIds.length;
      pageToken = page.nextPageToken ?? undefined;
      nextSyncToken = page.nextSyncToken;
    } while (pageToken);
  };

  try {
    await readAllPages();
  } catch (error) {
    if (!(error instanceof GoogleCalendarApiError) || error.status !== 410 || !syncToken) {
      throw error;
    }
    syncToken = undefined;
    pageToken = undefined;
    nextSyncToken = null;
    events = 0;
    cancelled = 0;
    seen.clear();
    await readAllPages();
  }

  if (!nextSyncToken) throw new Error("Google Calendar did not return a synchronization cursor.");
  const tokenUpdate = await client
    .from("external_calendars")
    .update({ encrypted_sync_token: encryptCredential(nextSyncToken) })
    .eq("id", calendar.id)
    .eq("user_id", userId);
  if (tokenUpdate.error) throw tokenUpdate.error;

  const missing = syncToken
    ? 0
    : await markMissing(client, userId, calendar.id, startsAt, endsAt, seen);
  return { events, cancelled, missing };
}

export async function runGoogleCalendarSync(): Promise<GoogleCalendarSyncResult> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const account = await googleAccount(client, userId);
  try {
    const provider = new GoogleCalendarProvider(await accessToken(client, account));
    requireCalendarCapability(provider, "list_calendars");
    requireCalendarCapability(provider, "list_events");
    const discovered = await provider.listCalendars();
    const calendars = await upsertCalendars(client, userId, account.id, discovered);
    const timeZone = resolveTimeZone();
    const today = todayIn(timeZone);
    const range = dayRangeIn(addDays(today, -90), addDays(today, 366), timeZone);
    const total: GoogleCalendarSyncResult = { calendars: 0, events: 0, cancelled: 0, missing: 0 };

    for (const calendar of calendars) {
      if (!calendar.selected) continue;
      const result = await syncCalendar(
        client,
        userId,
        provider,
        calendar,
        range.start,
        range.end,
        timeZone,
        hasCalendarCapabilities(account.capabilities, ["incremental_sync"])
          ? calendar.encrypted_sync_token
          : null,
      );
      total.calendars += 1;
      total.events += result.events;
      total.cancelled += result.cancelled;
      total.missing += result.missing;
    }

    const completedAt = new Date().toISOString();
    const complete = await client
      .from("external_calendar_accounts")
      .update({ status: "connected", last_success_at: completedAt, last_error_code: null })
      .eq("id", account.id)
      .eq("user_id", userId);
    if (complete.error) throw complete.error;
    return total;
  } catch (error) {
    await client
      .from("external_calendar_accounts")
      .update({ last_error_code: "google_sync_failed" })
      .eq("id", account.id)
      .eq("user_id", userId);
    throw error;
  }
}
