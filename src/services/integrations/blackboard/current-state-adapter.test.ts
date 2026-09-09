import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BlackboardIcsCurrentStateAdapter } from "./current-state-adapter";
import { BlackboardFetchError } from "./safe-fetch";

const calendar = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:item-1@example.invalid\r
DTSTAMP:20260910T010000Z\r
SUMMARY:[CS101] Assignment 1\r
CATEGORIES:Assignment,CS101\r
DTSTART;VALUE=DATE:20260918\r
URL:https://learn.example.edu/item?course_id=_101_1&content_id=_201_1\r
END:VEVENT\r
END:VCALENDAR`;

describe("Blackboard ICS current-state adapter", () => {
  it("fetches through the injected secure boundary then returns normalized observations", async () => {
    const adapter = new BlackboardIcsCurrentStateAdapter(["learn.example.edu"], {
      resolveAddresses: async () => [{ address: "8.8.8.8", family: 4 }],
      requestOnce: vi.fn().mockResolvedValue({
        status: 200,
        headers: { "content-type": "text/calendar" },
        body: calendar,
      }),
    });
    const snapshot = await adapter.read("webcal://learn.example.edu/private-token");
    expect(snapshot.complete).toBe(true);
    expect(snapshot.observations).toHaveLength(1);
    expect(snapshot.observations[0]).toMatchObject({
      uid: "item-1@example.invalid",
      itemType: "assignment",
      candidateSourceKey: "learn.example.edu:content_id:_201_1",
      candidateCourseKey: "learn.example.edu:_101_1",
      dueDate: "2026-09-18",
      duePrecision: "date",
    });
    expect(snapshot.characterization.calendar.eventCount).toBe(1);
    expect(JSON.stringify(snapshot.characterization)).not.toContain("private-token");
  });

  it.each(["timeout", "partial_response"])(
    "fails closed on a %s fetch without producing a complete snapshot",
    async (code) => {
      const adapter = new BlackboardIcsCurrentStateAdapter(["learn.example.edu"], {
        resolveAddresses: async () => [{ address: "8.8.8.8", family: 4 }],
        requestOnce: vi.fn().mockRejectedValue(
          new BlackboardFetchError(code, "Incomplete current-state read."),
        ),
      });
      await expect(
        adapter.read("https://learn.example.edu/private-token"),
      ).rejects.toMatchObject({ code });
    },
  );
});
