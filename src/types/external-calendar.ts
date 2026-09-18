export const calendarProviderCapabilities = [
  "list_calendars",
  "list_events",
  "create_event",
  "update_event",
  "delete_event",
  "incremental_sync",
  "watch_changes",
] as const;

export type CalendarProviderCapability = (typeof calendarProviderCapabilities)[number];
export type CalendarAccessMode = "read_only" | "read_write";

export type ExternalCalendarProviderId = "google" | "microsoft" | "icloud" | "caldav" | "ics";
export type ExternalCalendarConnectionStatus = "pending" | "connected" | "error" | "disconnected";

export type ExternalCalendarConnection = {
  id: string;
  provider: ExternalCalendarProviderId;
  displayName: string;
  status: ExternalCalendarConnectionStatus;
  access: CalendarAccessMode;
  capabilities: readonly CalendarProviderCapability[];
  credentialHint: string | null;
  tokenExpiresAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
};

export type ExternalCalendarProjection = {
  id: string;
  provider: ExternalCalendarProviderId;
  calendarId: string;
  externalCalendarId: string;
  calendarName: string;
  access: CalendarAccessMode;
  externalEventId: string;
  revision: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  courseCode?: string | null;
  courseId?: string | null;
  courseColor?: string | null;
};
