import { describe, expect, it } from "vitest";

import {
  isQuietHours,
  notificationDedupeKey,
  pushAvailability,
  safeDeepLink,
  safeNotificationPayload,
} from "@/services/notifications/notification-domain";

import { computeProposalRevision, parseBlackboardICalendar } from "./ical";
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
      dueDate: "2030-01-02",
      duePrecision: "instant",
      sourceUrl: "https://learn.example.edu/item/1",
      isFallbackUid: false,
    });
    expect(item.contentHash).toHaveLength(64);
    expect(item.proposalRevision).toHaveLength(64);
  });

  it("parses all-day date interval as date precision without inventing UTC instant", () => {
    const allDayFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-date-1\r\n" +
      "SUMMARY:History Project Due\r\n" +
      "DTSTART;VALUE=DATE:20261120\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = parseBlackboardICalendar(allDayFeed);
    expect(item.duePrecision).toBe("date");
    expect(item.dueDate).toBe("2026-11-20");
    expect(item.dueAt).toBeNull();
  });

  it("parses valid TZID into accurate UTC instant", () => {
    const tzidFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-tz-1\r\n" +
      "SUMMARY:Physics Quiz\r\n" +
      "DTEND;TZID=America/New_York:20261015T140000\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = parseBlackboardICalendar(tzidFeed);
    expect(item.duePrecision).toBe("instant");
    expect(item.dueAt).toBe("2026-10-15T18:00:00.000Z"); // EDT is UTC-4
    expect(item.dueDate).toBe("2026-10-15");
  });

  it("flags floating date-times as unresolved precision", () => {
    const floatingFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-floating-1\r\n" +
      "SUMMARY:Math Homework\r\n" +
      "DTSTART:20261015T140000\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = parseBlackboardICalendar(floatingFeed);
    expect(item.duePrecision).toBe("unresolved");
    expect(item.dueAt).toBeNull();
  });

  it("computes canonical proposal revision ignoring provider timestamp and URL churn", () => {
    const rev1 = computeProposalRevision({
      title: "  Final Paper  ",
      description: "Submit PDF",
      dueDate: "2026-12-01",
      dueAt: "2026-12-01T23:59:00.000Z",
      duePrecision: "instant",
      courseCode: "ENG201",
    });

    const rev2 = computeProposalRevision({
      title: "Final Paper",
      description: "Submit PDF",
      dueDate: "2026-12-01",
      dueAt: "2026-12-01T23:59:00.000Z",
      duePrecision: "instant",
      courseCode: "ENG201",
    });

    const revChanged = computeProposalRevision({
      title: "Final Paper - Revised",
      description: "Submit PDF",
      dueDate: "2026-12-01",
      dueAt: "2026-12-01T23:59:00.000Z",
      duePrecision: "instant",
      courseCode: "ENG201",
    });

    expect(rev1).toBe(rev2);
    expect(rev1).not.toBe(revChanged);
  });

  it("uses deterministic fallback identity and marks isFallbackUid", () => {
    const a = parseBlackboardICalendar(
      feed.replace("UID:item-1\r\n", "").replace("DTEND:20300102", "DTEND:20300103"),
    )[0];
    const b = parseBlackboardICalendar(
      feed.replace("UID:item-1\r\n", "").replace("DTEND:20300102", "DTEND:20300104"),
    )[0];
    expect(a.uid).toMatch(/^fallback:/);
    expect(a.isFallbackUid).toBe(true);
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
