import { beforeAll, describe, expect, it } from "vitest";

import {
  isQuietHours,
  notificationDedupeKey,
  pushAvailability,
  safeDeepLink,
  safeNotificationPayload,
} from "@/services/notifications/notification-domain";

import { computeProposalRevision, parseBlackboardICalendar, type BlackboardFeedItem } from "./ical";
import { isPublicAddress, validateFeedUrl } from "./safe-url";
import {
  blackboardRecordToExternalCalendarProjection,
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
  it("parses stable identity, deadline, source, and course", async () => {
    const [item] = await parseBlackboardICalendar(feed, {
      allowedHosts: ["learn.example.edu"],
      workspaceTimeZone: "Asia/Manila",
    });
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

  it("keeps recognized object identifiers but strips unknown event URL query values", async () => {
    const privateUrlFeed = feed.replace(
      "https://learn.example.edu/item/1",
      "https://learn.example.edu/item?course_id=_101_1&content_id=_201_1&token=private-secret",
    );
    const [item] = await parseBlackboardICalendar(privateUrlFeed, {
      allowedHosts: ["learn.example.edu"],
      workspaceTimeZone: "Asia/Manila",
    });
    expect(item.candidateSourceKey).toBe("learn.example.edu:content_id:_201_1");
    expect(item.sourceUrl).not.toContain("token");
    expect(item.sourceUrl).not.toContain("private-secret");
  });

  it("parses all-day date interval as date precision without inventing UTC instant", async () => {
    const allDayFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-date-1\r\n" +
      "SUMMARY:History Project Due\r\n" +
      "DTSTART;VALUE=DATE:20261120\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = await parseBlackboardICalendar(allDayFeed);
    expect(item.duePrecision).toBe("date");
    expect(item.dueDate).toBe("2026-11-20");
    expect(item.dueAt).toBeNull();
  });

  it("parses valid TZID into accurate UTC instant", async () => {
    const tzidFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-tz-1\r\n" +
      "SUMMARY:Physics Quiz\r\n" +
      "DTEND;TZID=America/New_York:20261015T140000\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = await parseBlackboardICalendar(tzidFeed);
    expect(item.duePrecision).toBe("instant");
    expect(item.dueAt).toBe("2026-10-15T18:00:00.000Z"); // EDT is UTC-4
    expect(item.dueDate).toBe("2026-10-16"); // Same instant on the Manila workspace calendar.
  });

  it("flags floating date-times as unresolved precision", async () => {
    const floatingFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-floating-1\r\n" +
      "SUMMARY:Math Homework\r\n" +
      "DTSTART:20261015T140000\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = await parseBlackboardICalendar(floatingFeed);
    expect(item.duePrecision).toBe("unresolved");
    expect(item.dueAt).toBeNull();
  });

  it("handles a DST fall-back instant deterministically without inventing a floating deadline", async () => {
    const dstFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-dst-1\r\n" +
      "SUMMARY:Systems Exam\r\n" +
      "DTEND;TZID=America/New_York:20261101T013000\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [first] = await parseBlackboardICalendar(dstFeed);
    const [second] = await parseBlackboardICalendar(dstFeed);
    expect(first.duePrecision).toBe("instant");
    expect(first.dueAt).toBe(second.dueAt);
    expect(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]).toContain(
      first.dueAt,
    );
  });

  it("routes recurrence and contradictory course hints to deterministic review", async () => {
    const reviewFeed =
      "BEGIN:VCALENDAR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:item-recurring-1\r\n" +
      "SUMMARY:[MATH101] Assignment clinic\r\n" +
      "CATEGORIES:Assignment,CS101\r\n" +
      "DTSTART:20260910T100000Z\r\n" +
      "RRULE:FREQ=WEEKLY;COUNT=3\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR";
    const [item] = await parseBlackboardICalendar(reviewFeed);
    expect(item).toMatchObject({
      itemType: "unknown",
      classificationReason: "recurrence_not_supported",
      courseCode: null,
      courseName: null,
      recurrence: true,
    });
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

  it("rejects UID-less events instead of inventing mutable identity", async () => {
    await expect(parseBlackboardICalendar(feed.replace("UID:item-1\r\n", ""))).rejects.toMatchObject({
      code: "invalid_event",
    });
  });

  it("rejects malformed and oversized calendar payloads before reconciliation", async () => {
    await expect(parseBlackboardICalendar("BEGIN:VCALENDAR\r\nBROKEN"))
      .rejects.toMatchObject({ code: "invalid_calendar" });
    await expect(
      parseBlackboardICalendar(
        `BEGIN:VCALENDAR\r\n${"X".repeat(2_000_001)}\r\nEND:VCALENDAR`,
      ),
    ).rejects.toMatchObject({ code: "calendar_too_large" });
  });

  it("deduplicates duplicate provider UIDs within one snapshot", async () => {
    const duplicate = feed.replace(
      "END:VCALENDAR",
      "BEGIN:VEVENT\r\nUID:item-1\r\nSUMMARY:Duplicate\r\nDTEND:20300103T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR",
    );
    await expect(parseBlackboardICalendar(duplicate)).resolves.toHaveLength(1);
  });
});

describe("Blackboard sync plan", () => {
  let item: BlackboardFeedItem;
  let existing: ExistingBlackboardRecord;
  beforeAll(async () => {
    item = (await parseBlackboardICalendar(feed))[0];
    existing = {
      id: "r1",
      externalUid: item.uid,
      contentHash: "old",
      taskId: "legacy-linked-task",
      dueAt: null,
      missingSince: null,
    };
  });

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

  it("resolves course strictly from known saved mapping and does not guess", () => {
    // Unmapped course yields "none" (routes to Unassigned Queue)
    expect(
      matchBlackboardCourse(
        "CS101",
        [
          { id: "a", code: "CS101", name: "One" },
          { id: "b", code: "CS-101", name: "Two" },
        ],
        {},
      ).kind,
    ).toBe("none");

    // Known saved mapping resolves to matched course ID
    expect(
      matchBlackboardCourse(
        "CS101",
        [{ id: "course-uuid-1", code: "CS101", name: "Computer Science" }],
        { CS101: "course-uuid-1" },
      ),
    ).toEqual({
      kind: "matched",
      courseId: "course-uuid-1",
      method: "known",
    });
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

describe("Blackboard calendar projection", () => {
  const MANILA = "Asia/Manila";

  it("projects a timed Blackboard external record into calendar projection with exact instant", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-1",
        account_id: "acc-1",
        external_uid: "item-1",
        normalized_title: "[CS101] Essay 1",
        course_code: "CS101",
        course_id: "course-1",
        source_url: "https://learn.example.edu/item/1",
        due_at: "2030-01-02T09:00:00.000Z",
        due_date: "2030-01-02",
        due_precision: "instant",
        content_hash: "hash123",
        missing_since: null,
        task_id: null,
        course: { id: "course-1", code: "CS101", name: "Computer Science", color: "blue" },
      },
      MANILA,
    );

    expect(projection).not.toBeNull();
    expect(projection).toMatchObject({
      id: "rec-1",
      provider: "blackboard",
      externalEventId: "item-1",
      title: "[CS101] Essay 1",
      startsAt: "2030-01-02T09:00:00.000Z",
      allDay: false,
      courseCode: "CS101",
      courseId: "course-1",
      courseColor: "blue",
    });
  });

  it("projects an all-day date-precision Blackboard record into zoned all-day interval", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-2",
        external_uid: "item-2",
        normalized_title: "History Project Due",
        course_code: "HIST201",
        due_at: null,
        due_date: "2026-11-20",
        due_precision: "date",
        content_hash: "hash456",
        missing_since: null,
        task_id: null,
      },
      MANILA,
    );

    expect(projection).not.toBeNull();
    expect(projection?.allDay).toBe(true);
    expect(projection?.courseCode).toBe("HIST201");
    expect(projection?.startsAt).toBe("2026-11-19T16:00:00.000Z");
    expect(projection?.endsAt).toBe("2026-11-20T16:00:00.000Z");
  });

  it("suppresses missing/disappeared records", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-3",
        external_uid: "item-3",
        normalized_title: "Deleted Homework",
        due_at: "2030-01-02T09:00:00.000Z",
        due_precision: "instant",
        content_hash: "hash789",
        missing_since: "2026-08-28T00:00:00Z",
        task_id: null,
      },
      MANILA,
    );

    expect(projection).toBeNull();
  });

  it("suppresses records already accepted into a native task to prevent duplication", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-4",
        external_uid: "item-4",
        normalized_title: "Accepted Task",
        due_at: "2030-01-02T09:00:00.000Z",
        due_precision: "instant",
        content_hash: "hash789",
        missing_since: null,
        task_id: "task-uuid-1",
      },
      MANILA,
    );

    expect(projection).toBeNull();
  });

  it("suppresses S2 observations linked to canonical School work", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-s2",
        external_uid: "item-s2",
        normalized_title: "Reconciled Assignment",
        due_at: "2030-01-02T09:00:00.000Z",
        due_precision: "instant",
        content_hash: "hash-s2",
        missing_since: null,
        task_id: null,
        school_item_id: "school-item-1",
      },
      MANILA,
    );

    expect(projection).toBeNull();
  });

  it("suppresses records without temporal data", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-5",
        external_uid: "item-5",
        normalized_title: "No Date Assignment",
        due_at: null,
        due_date: null,
        due_precision: "none",
        content_hash: "hash000",
        missing_since: null,
        task_id: null,
      },
      MANILA,
    );

    expect(projection).toBeNull();
  });
});
