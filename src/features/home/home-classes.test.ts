import { describe, expect, it } from "vitest";

import type { CourseWithMeetings } from "@/types/course";
import {
  findNextUpcomingClass,
  projectTodayClasses,
  resolveNextClass,
} from "./home-classes";

const TIMEZONE = "America/New_York"; // UTC-4 in EDT

function mockCourse(
  id: string,
  code: string,
  name: string,
  meetings: CourseWithMeetings["meetings"],
  overrides: Partial<CourseWithMeetings> = {},
): CourseWithMeetings {
  return {
    id,
    code,
    name,
    instructor: "Dr. Smith",
    location: "Main Hall",
    color: "#3b82f6",
    archivedAt: null,
    meetings,
    ...overrides,
  };
}

describe("Home Classes Projection (Phase 4B)", () => {
  // Date: Wednesday, October 14, 2026
  // Weekday: 3 (Wednesday)
  // Let's test at 11:00 AM EDT (15:00 UTC)
  const now = new Date("2026-10-14T15:00:00.000Z"); // 11:00 AM EDT

  const morningMeeting = {
    id: "m-1",
    courseId: "c-1",
    title: "Lecture",
    weekdays: [3], // Wednesday
    startDate: "2026-09-01",
    endDateExclusive: "2026-12-15",
    startTime: "09:00",
    endTime: "10:30",
    timeZone: TIMEZONE,
    location: "Room 101",
  };

  const activeMeeting = {
    id: "m-2",
    courseId: "c-2",
    title: "Lab Session",
    weekdays: [3], // Wednesday
    startDate: "2026-09-01",
    endDateExclusive: "2026-12-15",
    startTime: "10:45",
    endTime: "12:15",
    timeZone: TIMEZONE,
    location: "Lab 3A",
  };

  const afternoonMeeting = {
    id: "m-3",
    courseId: "c-3",
    title: "Seminar",
    weekdays: [3], // Wednesday
    startDate: "2026-09-01",
    endDateExclusive: "2026-12-15",
    startTime: "14:00",
    endTime: "15:30",
    timeZone: TIMEZONE,
    location: null, // Should fallback to course location
  };

  const thursdayMeeting = {
    id: "m-4",
    courseId: "c-1",
    title: "Discussion",
    weekdays: [4], // Thursday (2026-10-15)
    startDate: "2026-09-01",
    endDateExclusive: "2026-12-15",
    startTime: "10:00",
    endTime: "11:30",
    timeZone: TIMEZONE,
    location: "Room 202",
  };

  const sampleCourses: CourseWithMeetings[] = [
    mockCourse("c-1", "CS101", "Intro to CS", [morningMeeting, thursdayMeeting], { color: "#3b82f6" }),
    mockCourse("c-2", "PHYS201", "Physics II", [activeMeeting], { color: "#10b981" }),
    mockCourse("c-3", "MATH146", "Calculus", [afternoonMeeting], { color: "#f59e0b", location: "Math Bldg 200" }),
  ];

  it("projects all canonical course meetings occurring today in chronological order", () => {
    const todayOccurrences = projectTodayClasses(sampleCourses, TIMEZONE, now);

    expect(todayOccurrences).toHaveLength(3);
    expect(todayOccurrences[0].courseCode).toBe("CS101");
    expect(todayOccurrences[0].status).toBe("past");
    expect(todayOccurrences[0].timeRangeFormatted).toBe("9:00 AM – 10:30 AM");
    expect(todayOccurrences[0].location).toBe("Room 101");

    expect(todayOccurrences[1].courseCode).toBe("PHYS201");
    expect(todayOccurrences[1].status).toBe("in_progress");
    expect(todayOccurrences[1].timeRangeFormatted).toBe("10:45 AM – 12:15 PM");
    expect(todayOccurrences[1].location).toBe("Lab 3A");

    expect(todayOccurrences[2].courseCode).toBe("MATH146");
    expect(todayOccurrences[2].status).toBe("upcoming");
    expect(todayOccurrences[2].timeRangeFormatted).toBe("2:00 PM – 3:30 PM");
    expect(todayOccurrences[2].location).toBe("Math Bldg 200"); // Fallback to course location
  });

  it("prioritizes currently in-progress class as Next Class", () => {
    const next = resolveNextClass(sampleCourses, TIMEZONE, now);

    expect(next.kind).toBe("in_progress");
    if (next.kind === "in_progress") {
      expect(next.occurrence.courseCode).toBe("PHYS201");
      expect(next.occurrence.courseName).toBe("Physics II");
      expect(next.occurrence.relativeTimeText).toContain("In progress · Ends in 1h 15m");
      expect(next.occurrence.courseColor).toBe("#10b981");
    }
  });

  it("selects nearest upcoming class when no class is in progress", () => {
    // 12:30 PM EDT (16:30 UTC): activeMeeting (ends 12:15) is past, afternoonMeeting (14:00) is upcoming
    const noonNow = new Date("2026-10-14T16:30:00.000Z");
    const next = resolveNextClass(sampleCourses, TIMEZONE, noonNow);

    expect(next.kind).toBe("upcoming");
    if (next.kind === "upcoming") {
      expect(next.occurrence.courseCode).toBe("MATH146");
      expect(next.occurrence.relativeTimeText).toContain("Starts in 1h 30m");
    }
  });

  it("handles all classes completed today and projects next class on the next school day", () => {
    // 5:00 PM EDT (21:00 UTC): all Wednesday classes completed
    const eveningNow = new Date("2026-10-14T21:00:00.000Z");
    const next = resolveNextClass(sampleCourses, TIMEZONE, eveningNow);

    expect(next.kind).toBe("no_more_today");
    if (next.kind === "no_more_today") {
      expect(next.nextOccurrence).not.toBeNull();
      expect(next.nextOccurrence?.courseCode).toBe("CS101");
      expect(next.nextOccurrence?.date).toBe("2026-10-15"); // Thursday
      expect(next.nextOccurrence?.meetingTitle).toBe("Discussion");
      expect(next.nextOccurrence?.timeRangeFormatted).toBe("10:00 AM – 11:30 AM");
    }
  });

  it("handles a day with no classes scheduled but future classes exist", () => {
    // Sunday, October 18, 2026 (0 classes on Sunday)
    const sundayNow = new Date("2026-10-18T14:00:00.000Z");
    const todayClasses = projectTodayClasses(sampleCourses, TIMEZONE, sundayNow);
    expect(todayClasses).toHaveLength(0);

    const next = resolveNextClass(sampleCourses, TIMEZONE, sundayNow);
    expect(next.kind).toBe("none_today");
    if (next.kind === "none_today") {
      expect(next.nextOccurrence).not.toBeNull();
      expect(next.nextOccurrence?.courseCode).toBe("CS101"); // Wednesday/Thursday next week
    }
  });

  it("returns none_configured when user has no courses or no meetings", () => {
    expect(resolveNextClass([], TIMEZONE, now)).toEqual({ kind: "none_configured" });

    const emptyCourse = mockCourse("c-empty", "TEST", "Empty Course", []);
    expect(resolveNextClass([emptyCourse], TIMEZONE, now)).toEqual({
      kind: "none_configured",
    });
  });

  it("ignores archived courses", () => {
    const archivedCourse = mockCourse(
      "c-archived",
      "OLD101",
      "Archived Course",
      [morningMeeting],
      { archivedAt: "2026-08-01T00:00:00.000Z" },
    );

    const occurrences = projectTodayClasses([archivedCourse], TIMEZONE, now);
    expect(occurrences).toHaveLength(0);
  });

  it("finds next upcoming class within lookahead window", () => {
    const nextClass = findNextUpcomingClass(sampleCourses, TIMEZONE, now, 7);
    expect(nextClass).not.toBeNull();
    expect(nextClass?.courseCode).toBe("CS101");
    expect(nextClass?.date).toBe("2026-10-15");
  });
});
