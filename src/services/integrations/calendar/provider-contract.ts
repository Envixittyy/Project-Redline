import {
  calendarProviderCapabilities,
  type CalendarAccessMode,
  type CalendarProviderCapability,
} from "@/types/external-calendar";

export { calendarProviderCapabilities };
export type { CalendarAccessMode, CalendarProviderCapability };

export type ExternalCalendarRef = {
  providerId: string;
  externalCalendarId: string;
  name: string;
  access: CalendarAccessMode;
};

export type ExternalCalendarEvent = {
  providerId: string;
  externalCalendarId: string;
  externalEventId: string;
  revision: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
};

export type CalendarSyncPage = {
  events: readonly ExternalCalendarEvent[];
  deletedExternalEventIds: readonly string[];
  nextPageToken: string | null;
  nextSyncToken: string | null;
};

export interface ExternalCalendarProvider {
  readonly id: string;
  readonly capabilities: ReadonlySet<CalendarProviderCapability>;
  listCalendars(): Promise<readonly ExternalCalendarRef[]>;
  listEvents(input: {
    externalCalendarId: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    pageToken?: string;
    syncToken?: string;
  }): Promise<CalendarSyncPage>;
  createEvent?(calendarId: string, event: Omit<ExternalCalendarEvent, "providerId" | "externalEventId" | "revision">): Promise<ExternalCalendarEvent>;
  updateEvent?(event: ExternalCalendarEvent): Promise<ExternalCalendarEvent>;
  deleteEvent?(event: Pick<ExternalCalendarEvent, "externalCalendarId" | "externalEventId" | "revision">): Promise<void>;
  watchChanges?(calendarId: string, callbackUrl: URL): Promise<{ channelId: string; expiresAt: string }>;
}

export function requireCalendarCapability(
  provider: ExternalCalendarProvider,
  capability: CalendarProviderCapability,
): void {
  if (!provider.capabilities.has(capability)) {
    throw new Error(`${provider.id} does not support ${capability}.`);
  }
}
