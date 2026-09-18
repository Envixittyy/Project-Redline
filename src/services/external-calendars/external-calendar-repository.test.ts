import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRequireAuthenticatedSupabase = vi.fn();
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: () => mockRequireAuthenticatedSupabase(),
}));

import { listExternalCalendarEventsInRange } from "./external-calendar-repository";

describe("listExternalCalendarEventsInRange generic external calendar events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("returns mapped events when generic external calendar query succeeds", async () => {
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

    const results = await listExternalCalendarEventsInRange(
      "2030-01-01T00:00:00.000Z",
      "2030-01-31T23:59:59.000Z",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: "gen-1",
        provider: "google",
        title: "Team Meeting",
        calendarName: "Google Primary",
      }),
    );
  });

  it("gracefully returns empty array and logs diagnostic error when generic calendar query fails", async () => {
    const genericDbError = {
      code: "50000",
      message: "External calendar connection timeout",
      details: null,
      hint: null,
    };

    setupGenericEvents(null, genericDbError);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await listExternalCalendarEventsInRange(
      "2030-01-01T00:00:00.000Z",
      "2030-01-31T23:59:59.000Z",
    );

    expect(results).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[external-calendar] Generic external calendars provider failed to load events:"),
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });

  it("re-throws dynamic server errors", async () => {
    const dynamicError = { digest: "DYNAMIC_SERVER_USAGE" };
    mockRequireAuthenticatedSupabase.mockRejectedValue(dynamicError);

    await expect(
      listExternalCalendarEventsInRange("2030-01-01T00:00:00.000Z", "2030-01-31T23:59:59.000Z"),
    ).rejects.toEqual(dynamicError);
  });
});
