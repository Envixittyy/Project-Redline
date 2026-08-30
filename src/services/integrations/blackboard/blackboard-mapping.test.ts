import { describe, expect, it } from "vitest";

import { parseBlackboardICalendar } from "./ical";
import {
  blackboardRecordToExternalCalendarProjection,
  matchBlackboardCourse,
  planBlackboardSync,
  type ExistingBlackboardRecord,
} from "./sync-domain";

describe("Blackboard Manual Course Mapping & Deterministic Task Pipeline (Phase 7C)", () => {
  const sampleFeed =
    "BEGIN:VCALENDAR\r\n" +
    "BEGIN:VEVENT\r\n" +
    "UID:bb-item-101\r\n" +
    "SUMMARY:[CS101] Homework 1\r\n" +
    "DESCRIPTION:Complete exercises 1 to 5\r\n" +
    "DTEND:20261010T170000Z\r\n" +
    "LAST-MODIFIED:20261001T120000Z\r\n" +
    "URL:https://learn.example.edu/courses/1/hw1\r\n" +
    "END:VEVENT\r\n" +
    "BEGIN:VEVENT\r\n" +
    "UID:bb-item-202\r\n" +
    "SUMMARY:[MATH240] Linear Algebra Quiz\r\n" +
    "DESCRIPTION:Matrix operations\r\n" +
    "DTEND:20261012T140000Z\r\n" +
    "LAST-MODIFIED:20261001T120000Z\r\n" +
    "URL:https://learn.example.edu/courses/2/quiz1\r\n" +
    "END:VEVENT\r\n" +
    "END:VCALENDAR";

  const courses = [
    { id: "redline-course-cs101", code: "CS101", name: "Intro to Computer Science" },
    { id: "redline-course-math240", code: "MATH240", name: "Linear Algebra" },
  ];

  it("Stage 1 & 2: parses feed and resolves course strictly when saved in mappings", () => {
    const items = parseBlackboardICalendar(sampleFeed);
    expect(items).toHaveLength(2);

    const savedMappings: Record<string, string> = {
      CS101: "redline-course-cs101",
    };

    // Item 1 (CS101) is mapped
    const match1 = matchBlackboardCourse(items[0].courseCode, courses, savedMappings);
    expect(match1).toEqual({
      kind: "matched",
      courseId: "redline-course-cs101",
      method: "known",
    });

    // Item 2 (MATH240) is unmapped -> goes to Unassigned queue (zero AI guessing)
    const match2 = matchBlackboardCourse(items[1].courseCode, courses, savedMappings);
    expect(match2).toEqual({
      kind: "none",
    });
  });

  it("Stage 2: trim-safe mapping lookup without fuzzy guessing", () => {
    const savedMappings: Record<string, string> = {
      "PHYS 101": "redline-course-phys",
    };

    // Exact trimmed match succeeds
    expect(
      matchBlackboardCourse(
        "  PHYS 101  ",
        [{ id: "redline-course-phys", code: "PHYS101", name: "Physics" }],
        savedMappings,
      ),
    ).toEqual({
      kind: "matched",
      courseId: "redline-course-phys",
      method: "known",
    });

    // Similar but unmapped string does not match fuzzily
    expect(
      matchBlackboardCourse(
        "PHYS101-LAB",
        [{ id: "redline-course-phys", code: "PHYS101", name: "Physics" }],
        savedMappings,
      ),
    ).toEqual({
      kind: "none",
    });
  });

  it("Stage 3: deterministic deduplication and synchronization replay", () => {
    const items = parseBlackboardICalendar(sampleFeed);
    const existing: ExistingBlackboardRecord[] = [
      {
        id: "rec-1",
        externalUid: "bb-item-101",
        contentHash: items[0].contentHash,
        proposalRevision: items[0].proposalRevision,
        taskId: null,
        dueAt: items[0].dueAt,
        dueDate: items[0].dueDate,
        duePrecision: items[0].duePrecision,
        courseId: "redline-course-cs101",
        missingSince: null,
      },
    ];

    // Replay of same feed: rec-1 is unchanged; bb-item-202 is created
    const plan = planBlackboardSync(items, existing);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.unchanged[0].externalUid).toBe("bb-item-101");
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].uid).toBe("bb-item-202");
    expect(plan.updates).toHaveLength(0);
    expect(plan.missing).toHaveLength(0);
  });

  it("Stage 3: upstream deadline change produces update without duplicate item", () => {
    const modifiedFeed = sampleFeed.replace(
      "DTEND:20261010T170000Z",
      "DTEND:20261015T190000Z",
    );
    const items = parseBlackboardICalendar(modifiedFeed);

    const existing: ExistingBlackboardRecord[] = [
      {
        id: "rec-1",
        externalUid: "bb-item-101",
        contentHash: "old-hash",
        proposalRevision: "old-rev",
        taskId: null,
        dueAt: "2026-10-10T17:00:00.000Z",
        dueDate: "2026-10-10",
        duePrecision: "instant",
        courseId: "redline-course-cs101",
        missingSince: null,
      },
    ];

    const plan = planBlackboardSync(items, existing);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].record.externalUid).toBe("bb-item-101");
    expect(plan.updates[0].item.dueAt).toBe("2026-10-15T19:00:00.000Z");
  });

  it("Traceability: external calendar projection retains both canonical course and raw source", () => {
    const projection = blackboardRecordToExternalCalendarProjection(
      {
        id: "rec-1",
        account_id: "acc-1",
        external_uid: "bb-item-101",
        normalized_title: "[CS101] Homework 1",
        course_code: "CS101",
        course_id: "redline-course-cs101",
        due_at: "2026-10-10T17:00:00.000Z",
        due_date: "2026-10-10",
        due_precision: "instant",
        content_hash: "hash123",
        missing_since: null,
        task_id: null,
        course: {
          id: "redline-course-cs101",
          code: "CS101",
          name: "Intro to Computer Science",
          color: "#3b82f6",
        },
      },
      "UTC",
    );

    expect(projection).not.toBeNull();
    expect(projection?.courseId).toBe("redline-course-cs101");
    expect(projection?.courseCode).toBe("CS101");
    expect(projection?.courseColor).toBe("#3b82f6");
    expect(projection?.externalEventId).toBe("bb-item-101");
  });
});
