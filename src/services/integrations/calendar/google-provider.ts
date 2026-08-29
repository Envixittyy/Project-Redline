import "server-only";

import { fromZonedInputValue, isIsoDate, isIsoInstant } from "@/lib/date/day";

import type {
  CalendarSyncPage,
  ExternalCalendarEvent,
  ExternalCalendarProvider,
  ExternalCalendarRef,
} from "./provider-contract";

const API_ORIGIN = "https://www.googleapis.com";

export class GoogleCalendarApiError extends Error {
  constructor(readonly status: number) {
    super(status === 410 ? "The Google Calendar sync token expired." : "Google Calendar could not be reached.");
    this.name = "GoogleCalendarApiError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function eventBoundary(
  value: unknown,
  timeZone: string,
): { instant: string; allDay: boolean } | null {
  const boundary = record(value);
  const dateTime = text(boundary?.dateTime);
  if (dateTime && isIsoInstant(dateTime)) {
    return { instant: new Date(dateTime).toISOString(), allDay: false };
  }
  const date = text(boundary?.date);
  if (date && isIsoDate(date)) {
    return { instant: fromZonedInputValue(`${date}T00:00`, timeZone), allDay: true };
  }
  return null;
}

export function normalizeGoogleEvent(
  value: unknown,
  externalCalendarId: string,
  timeZone: string,
): { event?: ExternalCalendarEvent; deletedExternalEventId?: string } {
  const item = record(value);
  const externalEventId = text(item?.id);
  if (!item || !externalEventId) return {};
  if (item.status === "cancelled") return { deletedExternalEventId: externalEventId };

  const start = eventBoundary(item.start, timeZone);
  const end = eventBoundary(item.end, timeZone);
  if (!start || !end || Date.parse(end.instant) <= Date.parse(start.instant)) return {};

  const rawStatus = text(item.status);
  const status = rawStatus === "tentative" ? "tentative" : "confirmed";
  return {
    event: {
      providerId: "google",
      externalCalendarId,
      externalEventId,
      revision: text(item.etag) ?? text(item.updated) ?? externalEventId,
      title: text(item.summary) ?? "Busy",
      startsAt: start.instant,
      endsAt: end.instant,
      allDay: start.allDay && end.allDay,
      status,
    },
  };
}

export class GoogleCalendarProvider implements ExternalCalendarProvider {
  readonly id = "google";
  readonly capabilities = new Set(["list_calendars", "list_events", "incremental_sync"] as const);

  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async get(path: string, params: URLSearchParams): Promise<Record<string, unknown>> {
    const url = new URL(path, API_ORIGIN);
    url.search = params.toString();
    const response = await this.request(url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new GoogleCalendarApiError(response.status);
    }
    return payload as Record<string, unknown>;
  }

  async listCalendars(): Promise<readonly ExternalCalendarRef[]> {
    const calendars: ExternalCalendarRef[] = [];
    let pageToken: string | null = null;
    do {
      const params = new URLSearchParams({ maxResults: "250" });
      if (pageToken) params.set("pageToken", pageToken);
      const payload = await this.get("/calendar/v3/users/me/calendarList", params);
      for (const value of Array.isArray(payload.items) ? payload.items : []) {
        const item = record(value);
        const externalCalendarId = text(item?.id);
        if (!externalCalendarId || item?.deleted === true) continue;
        calendars.push({
          providerId: this.id,
          externalCalendarId,
          name: text(item?.summaryOverride) ?? text(item?.summary) ?? "Untitled calendar",
          access: "read_only",
        });
      }
      pageToken = text(payload.nextPageToken);
    } while (pageToken);
    return calendars;
  }

  async listEvents(input: {
    externalCalendarId: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    pageToken?: string;
    syncToken?: string;
  }): Promise<CalendarSyncPage> {
    const params = new URLSearchParams({
      maxResults: "2500",
      showDeleted: "true",
      singleEvents: "true",
    });
    if (input.pageToken) params.set("pageToken", input.pageToken);
    if (input.syncToken) {
      params.set("syncToken", input.syncToken);
    } else {
      params.set("timeMin", input.startsAt);
      params.set("timeMax", input.endsAt);
    }
    const payload = await this.get(
      `/calendar/v3/calendars/${encodeURIComponent(input.externalCalendarId)}/events`,
      params,
    );
    const events: ExternalCalendarEvent[] = [];
    const deletedExternalEventIds: string[] = [];
    for (const value of Array.isArray(payload.items) ? payload.items : []) {
      const normalized = normalizeGoogleEvent(value, input.externalCalendarId, input.timeZone);
      if (normalized.event) events.push(normalized.event);
      if (normalized.deletedExternalEventId) {
        deletedExternalEventIds.push(normalized.deletedExternalEventId);
      }
    }
    return {
      events,
      deletedExternalEventIds,
      nextPageToken: text(payload.nextPageToken),
      nextSyncToken: text(payload.nextSyncToken),
    };
  }
}
