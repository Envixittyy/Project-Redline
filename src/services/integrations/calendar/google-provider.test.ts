import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GoogleCalendarApiError, GoogleCalendarProvider, normalizeGoogleEvent } from "./google-provider";

describe("Google Calendar provider", () => {
  it("normalizes timed, all-day, private, and cancelled records", () => {
    expect(normalizeGoogleEvent({
      id: "timed",
      etag: "rev-1",
      summary: "Planning",
      status: "tentative",
      start: { dateTime: "2026-08-29T09:00:00+08:00" },
      end: { dateTime: "2026-08-29T10:00:00+08:00" },
    }, "primary", "Asia/Manila").event).toMatchObject({
      externalEventId: "timed",
      startsAt: "2026-08-29T01:00:00.000Z",
      status: "tentative",
      allDay: false,
    });
    expect(normalizeGoogleEvent({
      id: "all-day",
      start: { date: "2026-08-29" },
      end: { date: "2026-08-30" },
    }, "primary", "Asia/Manila").event).toMatchObject({
      title: "Busy",
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-29T16:00:00.000Z",
      allDay: true,
    });
    expect(normalizeGoogleEvent({ id: "gone", status: "cancelled" }, "primary", "Asia/Manila"))
      .toEqual({ deletedExternalEventId: "gone" });
  });

  it("paginates discovery and keeps event sync parameters compatible", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "primary", summary: "Main" }], nextPageToken: "next",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "team", summaryOverride: "Team" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextSyncToken: "sync-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextSyncToken: "sync-2" }), { status: 200 }));
    const provider = new GoogleCalendarProvider("secret-token", request);
    await expect(provider.listCalendars()).resolves.toHaveLength(2);
    await provider.listEvents({
      externalCalendarId: "primary",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      timeZone: "Asia/Manila",
    });
    await provider.listEvents({
      externalCalendarId: "primary",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      timeZone: "Asia/Manila",
      syncToken: "sync-1",
    });

    const initialUrl = request.mock.calls[2]?.[0] as URL;
    const incrementalUrl = request.mock.calls[3]?.[0] as URL;
    expect(initialUrl.searchParams.get("timeMin")).toBeTruthy();
    expect(initialUrl.searchParams.get("showDeleted")).toBe("true");
    expect(incrementalUrl.searchParams.get("syncToken")).toBe("sync-1");
    expect(incrementalUrl.searchParams.has("timeMin")).toBe(false);
    expect(incrementalUrl.toString()).not.toContain("secret-token");
  });

  it("surfaces an expired incremental token without provider detail", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 410 }));
    const provider = new GoogleCalendarProvider("secret-token", request);
    await expect(provider.listEvents({
      externalCalendarId: "primary",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      timeZone: "Asia/Manila",
      syncToken: "expired",
    })).rejects.toBeInstanceOf(GoogleCalendarApiError);
  });
});
