import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock server-only modules in vitest environment
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/prediction-actions", () => ({
  getActivePredictionsAction: vi.fn(async () => ({ ok: true, predictions: [] })),
  dismissPredictionAction: vi.fn(async () => ({ ok: true })),
  confirmPredictionAsTaskAction: vi.fn(async () => ({ ok: true })),
}));

import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { CourseWithMeetings } from "@/types/course";
import type { CourseMeeting, CourseWeekday } from "@/types/course-meeting";
import type { Task } from "@/types/task";

import { HomeDashboard } from "./home-dashboard";
import type { HomeGreeting, SystemTelemetry } from "./personality-greeting";

function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Complete lab report",
    description: null,
    status: "todo",
    priority: "high",
    dueDate: "2026-09-11",
    dueAt: "2026-09-11T14:00:00.000Z",
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: null,
    course: "BIO 101",
    parentTaskId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function mockCourse(overrides: Partial<CourseWithMeetings> = {}): CourseWithMeetings {
  return {
    id: "course-1",
    code: "CS 201",
    name: "Algorithms & Data Structures",
    color: "#2563eb",
    location: "Hall 302",
    instructor: "Dr. Smith",
    archivedAt: null,
    meetings: [
      {
        id: "meeting-1",
        courseId: "course-1",
        title: "Lecture",
        weekdays: [5], // Friday
        startDate: "2026-09-01",
        endDateExclusive: "2026-12-15",
        startTime: "10:00",
        endTime: "11:30",
        timeZone: "Asia/Manila",
        location: "Hall 302",
      },
    ],
    ...overrides,
  };
}

function mockCalendarItem(
  overrides: Partial<Extract<CalendarItem, { kind: "course_meeting" }>> = {},
): CalendarItem {
  const meeting: CourseMeeting = {
    id: "meeting-1",
    title: "Lecture",
    weekdays: [5 as CourseWeekday],
    startDate: "2026-09-01",
    endDateExclusive: "2026-12-15",
    startTime: "10:00",
    endTime: "11:30",
    timeZone: "Asia/Manila",
    course: {
      id: "course-1",
      label: "CS 201",
      color: "#2563eb",
    },
  };

  return {
    date: "2026-09-11",
    entry: {
      key: "course_meeting:meeting-1:2026-09-11",
      allDay: false,
      courseColor: "#2563eb",
      courseLabel: "CS 201",
      courseKey: "course-1",
      date: "2026-09-11",
      end: "2026-09-11T03:30:00.000Z",
      start: "2026-09-11T02:00:00.000Z",
      title: "Lecture",
      issues: [],
      kind: "course_meeting",
      occurrenceDate: "2026-09-11",
      meeting,
    },
    key: "course_meeting:meeting-1:2026-09-11",
    kind: "course_meeting",
    meeting,
    ...overrides,
  };
}

const mockGreeting: HomeGreeting = {
  eyebrow: "YOUR SPACE",
  greeting: "Good morning, Kyle.",
  subtext: "Here's where things stand.",
  isLateNight: false,
};

const mockTelemetry: SystemTelemetry = {
  loadLevel: "moderate",
  shortAssessment: "Manageable workload.",
  telemetryText: "1 CLASS · 2 OPEN · SYSTEM LOAD: MODERATE",
};

describe("S7D1 Home Screen Control Surface (HomeDashboard)", () => {
  it("renders the restrained greeting and system load telemetry badge", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[mockCourse()]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[mockCalendarItem()]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[mockTask()]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("YOUR SPACE");
    expect(html).toContain("Good morning, Kyle.");
    expect(html).toContain("Here&#x27;s where things stand.");
    expect(html).toContain("SYSTEM LOAD: MODERATE");
    expect(html).toContain("1 CLASS · 2 OPEN · SYSTEM LOAD: MODERATE");
    expect(html).toContain("Focus Mode");
  });

  it("renders primary daily agenda timeline with calendar commitments", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[mockCourse()]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[mockCalendarItem()]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("Today&#x27;s Agenda");
    expect(html).toContain("1 commitment");
    expect(html).toContain("Open Calendar →");
    expect(html).toContain("Lecture");
    expect(html).toContain("CS 201");
  });

  it("renders clear schedule state when no commitments exist for today", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("Clear schedule");
    expect(html).toContain("Nothing scheduled for today. Your day is open.");
  });

  it("renders today tasks and priority markers", () => {
    const task = mockTask({ title: "Physics homework problem 4", priority: "urgent" });
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[task]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("Action Items");
    expect(html).toContain("1 task for today");
    expect(html).toContain("Physics homework problem 4");
    expect(html).toContain("data-priority=\"urgent\"");
    expect(html).toContain("Open Tasks →");
  });

  it("renders empty tasks reassurance when today's tasks are clear", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("Clear tasks");
    expect(html).toContain("Nothing is due or scheduled today. Keep the space.");
  });

  it("renders overdue alert banner when overdue tasks exist and links to overdue triage", () => {
    const overdueTask = mockTask({
      id: "overdue-1",
      title: "Overdue Chemistry Lab",
      dueDate: "2026-09-08",
      dueAt: null,
    });

    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[]}
        greeting={mockGreeting}
        overdue={[overdueTask]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("Overdue Tasks");
    expect(html).toContain("1 need attention");
    expect(html).toContain("Overdue Chemistry Lab");
    expect(html).toContain("Review all 1 overdue tasks →");
  });

  it("omits overdue alert banner when overdue count is zero", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).not.toContain("Review all");
    expect(html).not.toContain("need attention");
  });

  it("renders academic enrolled courses and links to School", () => {
    const course = mockCourse({ code: "MATH 301", name: "Linear Algebra" });
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[course]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("1 active course");
    expect(html).toContain("MATH 301");
    expect(html).toContain("Linear Algebra");
    expect(html).toContain("href=\"/school\"");
  });

  it("renders quick notes tile linking to /notes", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[]}
        greeting={mockGreeting}
        overdue={[]}
        schedule={[]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[]}
        upcoming={[]}
      />,
    );

    expect(html).toContain("Quick Note");
    expect(html).toContain("Capture markdown thoughts or link them to courses.");
    expect(html).toContain("href=\"/notes\"");
  });

  it("preserves all 9 customizable widget IDs for backward compatibility with localStorage preferences", () => {
    const html = renderToStaticMarkup(
      <HomeDashboard
        courses={[mockCourse()]}
        greeting={mockGreeting}
        overdue={[mockTask({ id: "overdue-1" })]}
        schedule={[mockCalendarItem()]}
        telemetry={mockTelemetry}
        timeZone="Asia/Manila"
        today={[mockTask()]}
        upcoming={[mockTask({ id: "upcoming-1" })]}
      />,
    );

    const expectedWidgets = [
      "planning",
      "next_class",
      "today_classes",
      "schedule",
      "today",
      "overdue",
      "upcoming",
      "school",
      "notes",
    ];

    for (const widgetId of expectedWidgets) {
      expect(html).toContain(`data-dashboard-widget="${widgetId}"`);
    }
  });
});
