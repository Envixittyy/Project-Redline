export const calendarEventSources = ["life_os", "blackboard", "google_calendar", "academic_calendar"] as const;

export type CalendarEventSource = (typeof calendarEventSources)[number];

export const nativeCalendarEventTypes = [
  { id: "event", label: "Event" },
  { id: "personal", label: "Personal" },
  { id: "school", label: "School" },
  { id: "football", label: "Football" },
] as const;

export type NativeCalendarEventType = (typeof nativeCalendarEventTypes)[number]["id"];

/**
 * A source-aware calendar event. Scheduled tasks deliberately use `Task` and
 * are only projected into calendar presentation items at read time.
 */
export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  eventType: string;
  source: CalendarEventSource;
  externalId: string | null;
  sourceUrl: string | null;
  course: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEventDraft = {
  title: string;
  description?: string | null;
  start: string;
  end: string;
  allDay?: boolean;
  eventType?: string;
  source?: CalendarEventSource;
  externalId?: string | null;
  sourceUrl?: string | null;
  course?: string | null;
};

export type CalendarEventPatch = Partial<CalendarEventDraft>;

export function isCalendarEventSource(value: unknown): value is CalendarEventSource {
  return calendarEventSources.includes(value as CalendarEventSource);
}

export function isNativeCalendarEventType(value: unknown): value is NativeCalendarEventType {
  return nativeCalendarEventTypes.some((type) => type.id === value);
}
