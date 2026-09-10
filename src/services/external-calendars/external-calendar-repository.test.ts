import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRequireAuthenticatedSupabase = vi.fn();
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: () => mockRequireAuthenticatedSupabase(),
}));

const mockListBlackboardCalendarProjectionsInRange = vi.fn();
vi.mock("@/services/integrations/blackboard/blackboard-repository", () => ({
  listBlackboardCalendarProjectionsInRange: (...args: unknown[]) =>
    mockListBlackboardCalendarProjectionsInRange(...args),
}));

import { listExternalCalendarEventsInRange } from "./external-calendar-repository";
import type { ExternalCalendarProjection } from "@/types/external-calendar";

describe("listExternalCalendarEventsInRange provider aggregation and isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const blackboardEvent: ExternalCalendarProjection = {
    id: "bb-1",
    provider: "blackboard",
    calendarId: "blackboard",
    externalCalendarId: "blackboard",
    calendarName: "Blackboard",
    access: "read_only",
    externalEventId: "bb-evt-1",
    revision: "bb-rev-1",
    title: "CS101 Problem Set",
    startsAt: "2030-01-15T23:59:00.000Z",
    endsAt: "2030-01-16T00:59:00.000Z",
    allDay: false,
    status: "confirmed",
  };

  function setupGenericEvents(events: unknown[] | null, error: unknown = null) {
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockNeq = vi.fn().mockReturnThis();
    const mockIs = vi.fn().mockReturnThis();
    const mockLt = vi.fn().mockReturnThis();
    const mockGt = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockReturnThis();
    const mockLimit = vi.fn().mockResolvedValue({ data: events, error });

    const mockClient = {
      from: vi.fn(() => ({
        select: mockSelect,
        eq: mockEq,
        neq: mockNeq,
        is: mockIs,
        lt: mockLt,
        gt: mockGt,
        order: mockOrder,
        limit: mockLimit,
      })),
    };

    mockRequireAuthenticatedSupabase.mockResolvedValue({
      client: mockClient,
      userId: "user-1",
    });
  }

  it("aggregates events when both generic external calendars and Blackboard succeed", async () => {
    const dbGenericRows = [
      {
        id: "gen-1",
        external_event_id: "evt-1",
        revision: "rev-1",
        title: "Team Meeting",
        starts_at: "2030-01-15T14:00:00.000Z",
        ends_at: "2030-01-15T15:00:00.000Z",
        all_day: false,
        status: "confirmed",
        external_calendars: {
          id: "cal-1",
          external_calendar_id: "ext-cal-1",
          name: "Google Primary",
          access: "read_only",
          selected: true,
          external_calendar_accounts: {
            provider: "google",
            status: "connected",
          },
        },
      },
    ];

    setupGenericEvents(dbGenericRows);
    mockListBlackboardCalendarProjectionsInRange.mockResolvedValue([blackboardEvent]);

    const results = await listExternalCalendarEventsInRange(
      "2030-01-01T00:00:00.000Z",
      "2030-01-31T23:59:59.000Z",
    );

    expect(results).toHaveLength(2);
    expect(results).toEqual([
      expect.objectContaining({ id: "gen-1", provider: "google" }),
      expect.objectContaining({ id: "bb-1", provider: "blackboard" }),
    ]);
  });

  it("gracefully isolates Blackboard failure: returns generic events and logs diagnostic error", async () => {
    const dbGenericRows = [
      {
        id: "gen-1",
        external_event_id: "evt-1",
        revision: "rev-1",
        title: "Team Meeting",
        starts_at: "2030-01-15T14:00:00.000Z",
        ends_at: "2030-01-15T15:00:00.000Z",
        all_day: false,
        status: "confirmed",
        external_calendars: {
          id: "cal-1",
          external_calendar_id: "ext-cal-1",
          name: "Google Primary",
          access: "read_only",
          selected: true,
          external_calendar_accounts: {
            provider: "google",
            status: "connected",
          },
        },
      },
    ];

    setupGenericEvents(dbGenericRows);
    const blackboardDatabaseError = new Error("column external_records.school_item_id does not exist");
    mockListBlackboardCalendarProjectionsInRange.mockRejectedValue(blackboardDatabaseError);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await listExternalCalendarEventsInRange(
      "2030-01-01T00:00:00.000Z",
      "2030-01-31T23:59:59.000Z",
    );

    // Generic events still return intact so Home page remains functional
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "gen-1", provider: "google" });

    // Blackboard failure is logged and not silently swallowed
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[external-calendar] Blackboard calendar provider failed to load events:",
      blackboardDatabaseError,
    );

    consoleErrorSpy.mockRestore();
  });

  it("gracefully isolates generic calendar failure: returns Blackboard events and logs diagnostic error", async () => {
    const genericDbError = {
      code: "50000",
      message: "External calendar connection timeout",
      details: null,
      hint: null,
    };

    setupGenericEvents(null, genericDbError);
    mockListBlackboardCalendarProjectionsInRange.mockResolvedValue([blackboardEvent]);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await listExternalCalendarEventsInRange(
      "2030-01-01T00:00:00.000Z",
      "2030-01-31T23:59:59.000Z",
    );

    // Blackboard events still return intact
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "bb-1", provider: "blackboard" });

    // Generic calendar failure is logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[external-calendar] Generic external calendars provider failed to load events:"),
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });
});
