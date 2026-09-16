import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockSelectCourses = vi.fn();
const mockSelectMeetings = vi.fn();

vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: vi.fn(async () => ({
    userId: "user-test-1",
    client: {
      from: vi.fn((table: string) => {
        if (table === "courses") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  order: mockSelectCourses,
                }),
              }),
            }),
          };
        }
        if (table === "course_meetings") {
          return {
            select: () => ({
              eq: () => ({
                order: mockSelectMeetings,
              }),
            }),
          };
        }
        throw new Error("unexpected table " + table);
      }),
    },
  })),
}));

import { listCourses, listCourseMeetingsForCalendar } from "./course-repository";

describe("course repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectCourses.mockResolvedValue({
      data: [
        {
          id: "c-1",
          code: "CS101",
          name: "Computer Science",
          instructor: "Prof",
          location: "Hall A",
          color: "#fff",
          archived_at: null,
        },
      ],
      error: null,
    });
    mockSelectMeetings.mockResolvedValue({
      data: [
        {
          id: "m-1",
          course_id: "c-1",
          title: "Lecture",
          weekdays: [1, 3],
          start_date: "2026-09-01",
          end_date_exclusive: "2026-12-15",
          start_time: "10:00:00",
          end_time: "11:30:00",
          time_zone: "America/New_York",
          location: "Hall A",
        },
      ],
      error: null,
    });
  });

  it("lists courses with nested meetings", async () => {
    const courses = await listCourses();
    expect(courses).toHaveLength(1);
    expect(courses[0].id).toBe("c-1");
    expect(courses[0].meetings).toHaveLength(1);
    expect(courses[0].meetings[0].startTime).toBe("10:00");
  });

  it("flattens course meetings for calendar projection", async () => {
    const calendarMeetings = await listCourseMeetingsForCalendar();
    expect(calendarMeetings).toHaveLength(1);
    expect(calendarMeetings[0].id).toBe("m-1");
    expect(calendarMeetings[0].course.label).toBe("CS101 · Computer Science");
    expect(calendarMeetings[0].weekdays).toEqual([1, 3]);
  });
});
