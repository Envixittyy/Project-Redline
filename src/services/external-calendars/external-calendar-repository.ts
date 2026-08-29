import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { calendarProviderCapabilities } from "@/types/external-calendar";
import type {
  CalendarProviderCapability,
  ExternalCalendarConnection,
  ExternalCalendarProjection,
} from "@/types/external-calendar";
import { formatPostgrestErrorDiagnostic } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { listBlackboardCalendarProjectionsInRange } from "@/services/integrations/blackboard/blackboard-repository";

type ConnectionRow = {
  id: string;
  provider: ExternalCalendarConnection["provider"];
  display_name: string;
  status: ExternalCalendarConnection["status"];
  access: ExternalCalendarConnection["access"];
  capabilities: string[];
  credential_hint: string | null;
  token_expires_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
};

type AccountRelation = {
  provider: ExternalCalendarProjection["provider"];
  status: ExternalCalendarConnection["status"];
};

type CalendarRelation = {
  id: string;
  external_calendar_id: string;
  name: string;
  access: ExternalCalendarProjection["access"];
  selected: boolean;
  external_calendar_accounts: AccountRelation | AccountRelation[];
};

type EventRow = {
  id: string;
  external_event_id: string;
  revision: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: ExternalCalendarProjection["status"];
  external_calendars: CalendarRelation | CalendarRelation[];
};

export class ExternalCalendarRepositoryError extends Error {
  constructor(message: string, readonly detail?: PostgrestError) {
    super(message);
    this.name = "ExternalCalendarRepositoryError";
  }
}

function fail(action: string, error: PostgrestError): never {
  console.error(`[external-calendars] ${action} failed: ${formatPostgrestErrorDiagnostic(error)}`);
  throw new ExternalCalendarRepositoryError(`Could not ${action}. Please try again.`, error);
}

function one<T>(relation: T | T[]): T | null {
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function validCapabilities(values: readonly string[]): CalendarProviderCapability[] {
  const allowed = new Set<string>(calendarProviderCapabilities);
  return values.filter((value): value is CalendarProviderCapability => allowed.has(value));
}

export async function listExternalCalendarConnections(): Promise<ExternalCalendarConnection[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("external_calendar_accounts")
    .select("id,provider,display_name,status,access,capabilities,credential_hint,token_expires_at,last_success_at,last_error_code")
    .eq("user_id", userId)
    .order("provider", { ascending: true });
  if (error) fail("load external calendar connections", error);

  return (data as ConnectionRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    access: row.access,
    capabilities: validCapabilities(row.capabilities),
    credentialHint: row.credential_hint,
    tokenExpiresAt: row.token_expires_at,
    lastSuccessAt: row.last_success_at,
    lastErrorCode: row.last_error_code,
  }));
}

export async function saveGoogleCalendarConnection(input: {
  encryptedCredential: string;
  expiresAt: string;
}): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.from("external_calendar_accounts").upsert({
    user_id: userId,
    provider: "google",
    display_name: "Google Calendar",
    status: "connected",
    access: "read_only",
    capabilities: ["list_calendars", "list_events", "incremental_sync"],
    encrypted_credential: input.encryptedCredential,
    credential_hint: "OAuth",
    token_expires_at: input.expiresAt,
    last_error_code: null,
  }, { onConflict: "user_id,provider" });
  if (error) fail("save the Google Calendar connection", error);
}

/** Read-only mirror projection for the visible half-open Calendar range across external calendars and Blackboard. */
export async function listExternalCalendarEventsInRange(
  start: string,
  end: string,
): Promise<ExternalCalendarProjection[]> {
  const [genericEvents, blackboardEvents] = await Promise.all([
    listGenericExternalCalendarEventsInRange(start, end),
    listBlackboardCalendarProjectionsInRange(start, end),
  ]);

  return [...genericEvents, ...blackboardEvents];
}

async function listGenericExternalCalendarEventsInRange(
  start: string,
  end: string,
): Promise<ExternalCalendarProjection[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client
    .from("external_calendar_events")
    .select("id,external_event_id,revision,title,starts_at,ends_at,all_day,status,external_calendars!inner(id,external_calendar_id,name,access,selected,external_calendar_accounts!inner(provider,status))")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .is("missing_since", null)
    .eq("external_calendars.selected", true)
    .eq("external_calendars.external_calendar_accounts.status", "connected")
    .lt("starts_at", end)
    .gt("ends_at", start)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) fail("load external calendar events", error);

  return (data as unknown as EventRow[]).flatMap((row) => {
    const calendar = one(row.external_calendars);
    const account = calendar ? one(calendar.external_calendar_accounts) : null;
    if (!calendar || !account || !calendar.selected || account.status !== "connected") return [];
    return [{
      id: row.id,
      provider: account.provider,
      calendarId: calendar.id,
      externalCalendarId: calendar.external_calendar_id,
      calendarName: calendar.name,
      access: calendar.access,
      externalEventId: row.external_event_id,
      revision: row.revision,
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      status: row.status,
    }];
  });
}
