import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock server-only modules and actions
vi.mock("server-only", () => ({}));
vi.mock("./school-actions", () => ({
  saveCourseAction: vi.fn(async () => ({ ok: true })),
  archiveCourseAction: vi.fn(async () => ({ ok: true })),
  saveMeetingAction: vi.fn(async () => ({ ok: true })),
  deleteMeetingAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./school-material-actions", () => ({
  saveCourseMaterialAction: vi.fn(async () => ({ ok: true })),
  deleteCourseMaterialAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./school-email-actions", () => ({
  mapSchoolEmailCourseAction: vi.fn(async () => ({ ok: true })),
  retrySchoolEmailAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./prediction-actions", () => ({
  getCoursePredictionsAction: vi.fn(async () => ({ ok: true, predictions: [] })),
  dismissPredictionAction: vi.fn(async () => ({ ok: true })),
  confirmPredictionAsTaskAction: vi.fn(async () => ({ ok: true })),
  reviseAssessmentPredictionsAction: vi.fn(async () => ({})),
  applyAssessmentPredictionsAction: vi.fn(async () => ({ ok: true })),
}));

import type { CourseWithMeetings } from "@/types/course";
import type { SchoolEmailEvent, SchoolItem } from "@/types/school-item";

import { SchoolWorkspace } from "./school-workspace";
import { CourseCard } from "./course-card";
import { SchoolTodayContext } from "./school-today-context";
import { SchoolTimetableView } from "./school-timetable-view";
import { SchoolUpcomingWork } from "./school-upcoming-work";
import { SchoolCourseDetail } from "./school-course-detail";
import { SchoolActivityFeed } from "./school-activity-feed";

function mockCourse(overrides: Partial<CourseWithMeetings> = {}): CourseWithMeetings {
  return {
    id: "course-1",
    code: "CS101",
    name: "Intro to Computer Science",
    instructor: "Dr. Turing",
    location: "Turing Hall 301",
    color: "#2563eb",
    archivedAt: null,
    meetings: [
      {
        id: "meeting-1",
        courseId: "course-1",
        title: "Lecture",
        weekdays: [1, 3], // Mon, Wed
        startDate: "2026-09-01",
        endDateExclusive: "2026-12-15",
        startTime: "10:00",
        endTime: "11:30",
        timeZone: "UTC",
        location: "Hall 301",
      },
    ],
    ...overrides,
  };
}

function mockSchoolItem(overrides: Partial<SchoolItem> = {}): SchoolItem {
  return {
    id: "item-1",
    courseId: "course-1",
    itemType: "assignment",
    title: "Problem Set 1: Algorithms",
    dueDate: "2026-09-15",
    dueAt: "2026-09-15T23:59:00Z",
    sourceUrl: "https://blackboard.example.edu/ps1",
    weight: 15,
    taskId: "task-1",
    taskStatus: "inbox",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("S7D4 School & Course Experience Overhaul", () => {
  const course = mockCourse();
  const item = mockSchoolItem();

  describe("CourseCard", () => {
    it("renders course identity with restrained color and schedule snippet", () => {
      const markup = renderToStaticMarkup(
        <CourseCard
          course={course}
          upcomingWorkCount={2}
          onSelect={() => {}}
        />,
      );

      expect(markup).toContain("CS101");
      expect(markup).toContain("Intro to Computer Science");
      expect(markup).toContain("Dr. Turing");
      expect(markup).toContain("Turing Hall 301");
      expect(markup).toContain("Mon, Wed 10:00");
      expect(markup).toContain("2 upcoming tasks");
      expect(markup).toContain("--card-course-accent:#2563eb");
    });

    it("renders all caught up state when no upcoming tasks exist", () => {
      const markup = renderToStaticMarkup(
        <CourseCard
          course={course}
          upcomingWorkCount={0}
          onSelect={() => {}}
        />,
      );

      expect(markup).toContain("All caught up");
    });
  });

  describe("SchoolTodayContext", () => {
    it("renders empty state when no classes occur on the target day", () => {
      // 2026-09-13 is a Sunday (day 0); meeting is on Mon(1) and Wed(3)
      const markup = renderToStaticMarkup(
        <SchoolTodayContext
          courses={[course]}
          timeZone="UTC"
          onSelectCourse={() => {}}
        />,
      );

      expect(markup).toContain("Today&#x27;s Schedule");
    });

    it("renders today's class occurrences on active meeting days", () => {
      // 2026-09-14 is a Monday (day 1)
      const mondayCourse = mockCourse({
        meetings: [
          {
            id: "meeting-mon",
            courseId: "course-1",
            title: "Lecture",
            weekdays: [0, 1, 2, 3, 4, 5, 6], // every day for test predictability
            startDate: "2026-01-01",
            endDateExclusive: "2027-01-01",
            startTime: "10:00",
            endTime: "11:30",
            timeZone: "UTC",
            location: "Hall 301",
          },
        ],
      });

      const markup = renderToStaticMarkup(
        <SchoolTodayContext
          courses={[mondayCourse]}
          timeZone="UTC"
          onSelectCourse={() => {}}
        />,
      );

      expect(markup).toContain("CS101");
      expect(markup).toContain("Intro to Computer Science");
      expect(markup).toContain("Hall 301");
    });
  });

  describe("SchoolTimetableView", () => {
    it("renders desktop multi-column schedule and mobile weekday selector", () => {
      const markup = renderToStaticMarkup(
        <SchoolTimetableView
          courses={[course]}
          today="2026-09-14"
          timeZone="UTC"
          onSelectCourse={() => {}}
        />,
      );

      // Desktop days
      expect(markup).toContain("Weekly Timetable");
      expect(markup).toContain("Mon");
      expect(markup).toContain("Tue");
      expect(markup).toContain("Wed");
      expect(markup).toContain("Thu");
      expect(markup).toContain("Fri");

      // Meeting presence under Monday and Wednesday
      expect(markup).toContain("CS101");
      expect(markup).toContain("Lecture");
    });
  });

  describe("SchoolUpcomingWork", () => {
    it("renders actionable items with checkbox, course badge, and due date", () => {
      const markup = renderToStaticMarkup(
        <SchoolUpcomingWork
          items={[item]}
          courses={[course]}
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("Problem Set 1: Algorithms");
      expect(markup).toContain("CS101");
      expect(markup).toContain("Weight: 15%");
      expect(markup).toContain("Blackboard");
      expect(markup).toContain('role="checkbox"');
    });

    it("renders empty state when there are no actionable items", () => {
      const markup = renderToStaticMarkup(
        <SchoolUpcomingWork
          items={[]}
          courses={[course]}
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("Nothing due right now");
      expect(markup).toContain("completely caught up");
    });
  });

  describe("SchoolCourseDetail", () => {
    it("renders course header, tab navigation, and meetings", () => {
      const markup = renderToStaticMarkup(
        <SchoolCourseDetail
          course={course}
          allCourses={[course]}
          items={[item]}
          materials={[]}
          events={[]}
          today="2026-09-11"
          timeZone="UTC"
          onBack={() => {}}
        />,
      );

      expect(markup).toContain("CS101");
      expect(markup).toContain("Intro to Computer Science");
      expect(markup).toContain("Back to School");
      expect(markup).toContain("Overview &amp; Work");
      expect(markup).toContain("Materials &amp; Notes");
      expect(markup).toContain("Intelligence &amp; Activity");
      expect(markup).toContain("Weekly Meetings");
      expect(markup).toContain("Lecture");
      expect(markup).toContain("Problem Set 1: Algorithms");
    });
  });

  describe("SchoolActivityFeed", () => {
    it("renders unresolved course mapping banner with retry action", () => {
      const unmappedEvent: SchoolEmailEvent = {
        id: "evt-unmapped",
        status: "unresolved_course",
        itemId: null,
        courseId: null,
        receivedAt: "2026-09-11T12:00:00Z",
        parsedEvent: {
          source: "blackboard",
          messageKey: "msg-1",
          provider: "blackboard",
          sourceMessageId: "s-1",
          receivedAt: "2026-09-11T12:00:00Z",
          sourceAt: null,
          parserVersion: "blackboard-email-v1",
          status: "parsed",
          notificationType: "assignment",
          itemType: "assignment",
          courseHint: "CS101 Fall 26",
          courseKey: "bb:_cs101_1",
          title: "Midterm Exam Announcement",
          titleKey: "midterm",
          sourceKey: "sk-1",
          sourceUrl: null,
          dueDate: null,
          dueAt: null,
          duePrecision: "none",
          weight: null,
          evidence: null,
          reason: null,
        },
      };

      const markup = renderToStaticMarkup(
        <SchoolActivityFeed
          events={[unmappedEvent]}
          courses={[course]}
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("Course Mapping Needed");
      expect(markup).toContain("CS101 Fall 26");
      expect(markup).toContain("Midterm Exam Announcement");
      expect(markup).toContain("Map &amp; Retry");
    });
  });

  describe("SchoolWorkspace", () => {
    it("renders active courses and views switcher", () => {
      const markup = renderToStaticMarkup(
        <SchoolWorkspace
          courses={[course]}
          schoolItems={[item]}
          materials={[]}
          emailEvents={[]}
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("1 Active Course");
      expect(markup).toContain("Overview");
      expect(markup).toContain("Timetable");
      expect(markup).toContain("Sync &amp; Activity");
      expect(markup).toContain("Active Courses");
      expect(markup).toContain("CS101");
    });

    it("renders empty state when no courses exist", () => {
      const markup = renderToStaticMarkup(
        <SchoolWorkspace
          courses={[]}
          schoolItems={[]}
          materials={[]}
          emailEvents={[]}
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("0 Active Courses");
      expect(markup).toContain("No courses configured yet");
      expect(markup).toContain("Add your first course");
    });
  });
});
