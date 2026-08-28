import { describe, expect, it } from "vitest";

import {
  isQuietHours,
  notificationDedupeKey,
  pushAvailability,
  safeDeepLink,
  safeNotificationPayload,
} from "@/services/notifications/notification-domain";

import { parseBlackboardICalendar } from "./ical";
import { isPublicAddress, validateFeedUrl } from "./safe-url";
import {
  matchBlackboardCourse,
  planBlackboardSync,
  type ExistingBlackboardRecord,
} from "./sync-domain";

const feed =
  "BEGIN:VCALENDAR\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:item-1\r\n" +
  "SUMMARY:[CS101] Essay\r\n" +
  "DESCRIPTION:Read\\nWrite\r\n" +
  "DTEND:20300102T090000Z\r\n" +
  "LAST-MODIFIED:20300101T010000Z\r\n" +
  "URL:https://learn.example.edu/item/1\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR";

describe("Blackboard iCalendar", () => {
  it("parses stable identity, deadline, source, and course", () => {
    const [item] = parseBlackboardICalendar(feed);
    expect(item).toMatchObject({
      uid: "item-1",
      title: "[CS101] Essay",
      courseCode: "CS101",
      dueAt: "2030-01-02T09:00:00.000Z",
      sourceUrl: "https://learn.example.edu/item/1",
    });
    expect(item.contentHash).toHaveLength(64);
  });

  it("uses deterministic fallback identity without merging different deadlines", () => {
    const a = parseBlackboardICalendar(
      feed.replace("UID:item-1\r\n", "").replace("DTEND:20300102", "DTEND:20300103"),
    )[0];
    const b = parseBlackboardICalendar(
      feed.replace("UID:item-1\r\n", "").replace("DTEND:20300102", "DTEND:20300104"),
    )[0];
    expect(a.uid).toMatch(/^fallback:/);
    expect(a.uid).not.toBe(b.uid);
  });
});

describe("Blackboard sync plan", () => {
  const item = parseBlackboardICalendar(feed)[0];
  const existing: ExistingBlackboardRecord = {
    id: "r1",
    externalUid: item.uid,
    contentHash: "old",
    taskId: "legacy-linked-task",
    dueAt: null,
    missingSince: null,
  };

  it("deduplicates repeated feed items and plans provider-record fields only", () => {
    const plan = planBlackboardSync([item, item], [existing]);
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toEqual([{ record: existing, item }]);
    expect(plan.updates[0]).not.toHaveProperty("taskPatch");
  });

  it("is unchanged on an idempotent retry", () => {
    expect(
      planBlackboardSync([item], [{ ...existing, contentHash: item.contentHash }]).unchanged,
    ).toHaveLength(1);
  });

  it("marks disappeared records missing rather than deleting", () => {
    expect(planBlackboardSync([], [existing]).missing).toEqual([existing]);
  });

  it("does not silently resolve ambiguous courses", () => {
    expect(
      matchBlackboardCourse(
        "CS101",
        [
          { id: "a", code: "CS101", name: "One" },
          { id: "b", code: "CS-101", name: "Two" },
        ],
        {},
      ).kind,
    ).toBe("ambiguous");
  });
});

describe("SSRF and credential redaction boundaries", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1"])(
    "rejects private address %s",
    (address) => expect(isPublicAddress(address)).toBe(false),
  );

  it("requires standard credential-free HTTPS", () => {
    expect(() => validateFeedUrl("http://learn.example.edu/feed")).toThrow();
    expect(() => validateFeedUrl("https://user:secret@learn.example.edu/feed")).toThrow();
    expect(validateFeedUrl("https://learn.example.edu/feed").hostname).toBe(
      "learn.example.edu",
    );
  });

  it("redacts URLs from notification payloads", () => {
    expect(
      safeNotificationPayload({
        title: "Update",
        body: "Open https://private.example/token",
        deepLink: "/tasks",
        dedupeKey: "x",
      }).body,
    ).not.toContain("private.example");
  });
});

describe("notification rules", () => {
  it("deduplicates persistently and validates deep links", () => {
    expect(notificationDedupeKey("blackboard_assignment", "1", "a")).toBe(
      notificationDedupeKey("blackboard_assignment", "1", "a"),
    );
    expect(safeDeepLink("https://evil.example")).toBe("/");
    expect(safeDeepLink("/tasks?view=today")).toBe("/tasks?view=today");
  });

  it("respects overnight quiet hours", () => {
    expect(
      isQuietHours(new Date("2030-01-01T15:30:00Z"), "Asia/Manila", "22:00", "07:00"),
    ).toBe(true);
    expect(
      isQuietHours(new Date("2030-01-01T04:00:00Z"), "Asia/Manila", "22:00", "07:00"),
    ).toBe(false);
  });

  it("reports unavailable iPhone push honestly", () => {
    expect(
      pushAvailability({
        serviceWorker: true,
        pushManager: true,
        standalone: false,
        isIOS: true,
        vapidKey: true,
      }),
    ).toEqual({ available: false, reason: "install_required" });
  });
});
