import { describe, expect, it } from "vitest";
import type { CourseWithMeetings } from "@/types/course";
import type { SchoolEmailEvent, SchoolItem } from "@/types/school-item";
import {
  findSchoolEventCourse,
  isSchoolItemTaskCompleted,
  schoolEventBelongsToCourse,
} from "./school-ui-domain";

const courses = [
  { id: "course-a", code: "CS101", name: "Computer Science", instructor: null, location: null, color: null, archivedAt: null, meetings: [] },
  { id: "course-b", code: "MATH201", name: "Calculus", instructor: null, location: null, color: null, archivedAt: null, meetings: [] },
] satisfies CourseWithMeetings[];

const event = {
  id: "event",
  status: "processed",
  itemId: "item",
  courseId: "course-b",
  receivedAt: "2026-09-08T02:01:00Z",
  parsedEvent: { courseHint: "CS101", courseKey: "learn.example.edu:_101_1" },
} as SchoolEmailEvent;

describe("School UI canonical relationships", () => {
  it("uses the persisted item course instead of reconstructing a match from email hints", () => {
    expect(findSchoolEventCourse(event, courses)?.id).toBe("course-b");
    expect(schoolEventBelongsToCourse(event, "course-b")).toBe(true);
    expect(schoolEventBelongsToCourse(event, "course-a")).toBe(false);
  });

  it("does not collapse Submitted into the completed Task state", () => {
    expect(isSchoolItemTaskCompleted({ taskStatus: "completed" } as SchoolItem)).toBe(true);
    expect(isSchoolItemTaskCompleted({ taskStatus: "submitted" } as SchoolItem)).toBe(false);
  });
});
