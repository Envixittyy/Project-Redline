import type { ExternalCalendarProviderId } from "@/types/external-calendar";

export type CalendarProviderCatalogItem = {
  id: ExternalCalendarProviderId;
  label: string;
  connectionKind: "oauth" | "credential" | "subscription";
  description: string;
};

/** Product-facing provider choices. Runtime capabilities come from each connected account. */
export const calendarProviderCatalog: readonly CalendarProviderCatalogItem[] = [
  { id: "google", label: "Google Calendar", connectionKind: "oauth", description: "Connect a Google account through OAuth." },
  { id: "microsoft", label: "Microsoft Outlook", connectionKind: "oauth", description: "Connect a Microsoft account through OAuth." },
  { id: "icloud", label: "iCloud Calendar", connectionKind: "credential", description: "Requires an app-specific Apple credential." },
  { id: "caldav", label: "CalDAV", connectionKind: "credential", description: "Connect a compatible CalDAV server." },
  { id: "ics", label: "ICS subscription", connectionKind: "subscription", description: "Subscribe to a read-only calendar feed." },
] as const;
