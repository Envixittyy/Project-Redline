import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/calendar",
}));

import type { CalendarItem } from "./calendar-items";
import { CalendarWorkspace } from "./calendar-workspace";

function mockCalendarEvent(
  overrides: Partial<Extract<CalendarItem, { kind: "event" }>> = {},
): CalendarItem {
  const event = {
    id: "ev-1",
    title: "Team Retrospective",
    description: "Sprint review",
    start: "2026-09-11T14:00:00.000Z",
    end: "2026-09-11T15:00:00.000Z",
    allDay: false,
    eventType: "event",
    course: null,
    source: "life_os" as const,
    externalId: null,
    sourceUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  return {
    key: "event-1:2026-09-11",
    kind: "event",
    date: "2026-09-11",
    event,
    entry: {
      key: "ev-1",
      title: "Team Retrospective",
      date: "2026-09-11",
      start: "2026-09-11T14:00:00.000Z",
      end: "2026-09-11T15:00:00.000Z",
      allDay: false,
      courseKey: null,
      courseLabel: null,
      courseColor: null,
      issues: [],
      kind: "calendar_event",
      event,
    },
    ...overrides,
  };
}

function mockCourseMeeting(
  overrides: Partial<Extract<CalendarItem, { kind: "course_meeting" }>> = {},
): CalendarItem {
  const meeting = {
    id: "meet-1",
    title: "Algorithms Lecture",
    course: {
      id: "course-1",
      label: "CS 201",
      color: "#3b82f6",
    },
    weekdays: [5 as const],
    startDate: "2026-09-01",
    endDateExclusive: "2026-12-15",
    startTime: "10:00",
    endTime: "11:30",
    timeZone: "UTC",
  };

  return {
    key: "meeting-1:2026-09-11",
    kind: "course_meeting",
    date: "2026-09-11",
    meeting,
    entry: {
      key: "meet-1",
      title: "Algorithms Lecture",
      date: "2026-09-11",
      start: "2026-09-11T10:00:00.000Z",
      end: "2026-09-11T11:30:00.000Z",
      allDay: false,
      courseKey: "course-1",
      courseLabel: "CS 201",
      courseColor: "#3b82f6",
      issues: [],
      kind: "course_meeting",
      meeting,
      occurrenceDate: "2026-09-11",
    },
    ...overrides,
  };
}

describe("CalendarWorkspace component", () => {
  const defaultProps = {
    view: "month" as const,
    anchor: "2026-09-11",
    heading: "September 2026",
    fromDate: "2026-08-31",
    toDateExclusive: "2026-10-12",
    today: "2026-09-11",
    timeZone: "UTC",
    items: [mockCalendarEvent(), mockCourseMeeting()],
    taskOptions: [{ id: "task-1", title: "Assignment 1" }],
  };

  it("renders toolbar with heading, navigation links, and view switcher", () => {
    const html = renderToStaticMarkup(<CalendarWorkspace {...defaultProps} />);
    expect(html).toContain("September 2026");
    expect(html).toContain("Today");
    expect(html).toContain("Previous period");
    expect(html).toContain("Next period");
    expect(html).toContain("Calendar view");
    expect(html).toContain("Month");
    expect(html).toContain("Week");
    expect(html).toContain("Agenda");
  });

  it("renders mobile compact week strip with day dates and indicators", () => {
    const html = renderToStaticMarkup(<CalendarWorkspace {...defaultProps} />);
    expect(html).toContain("mobileWeekStrip");
    expect(html).toContain("stripDay");
    // Should render days of week containing Sep 11: 7, 8, 9, 10, 11, 12, 13
    expect(html).toContain("data-today=\"true\"");
    expect(html).toContain("data-selected=\"true\"");
  });

  it("renders selected-day agenda with schedule items and badges", () => {
    const html = renderToStaticMarkup(<CalendarWorkspace {...defaultProps} />);
    expect(html).toContain("selectedDayAgenda");
    expect(html).toContain("Team Retrospective");
    expect(html).toContain("Algorithms Lecture");
    expect(html).toContain("CS 201");
  });

  it("renders clean empty day message when selected day has no commitments", () => {
    const html = renderToStaticMarkup(
      <CalendarWorkspace
        {...defaultProps}
        items={[]} // Empty items
      />,
    );
    expect(html).toContain("Nothing scheduled.");
    expect(html).toContain("Your day is open.");
  });

  it("renders desktop 7-column month grid with comfortable cell sizing", () => {
    const html = renderToStaticMarkup(<CalendarWorkspace {...defaultProps} />);
    expect(html).toContain("desktopMonthFrame");
    expect(html).toContain("monthGrid");
    expect(html).toContain("Mon");
    expect(html).toContain("Sun");
  });

  it("renders week view with strip and agenda on mobile, and week scroller on desktop", () => {
    const html = renderToStaticMarkup(
      <CalendarWorkspace
        {...defaultProps}
        view="week"
        heading="Sep 7–13, 2026"
        fromDate="2026-09-07"
        toDateExclusive="2026-09-14"
      />,
    );
    expect(html).toContain("mobileWeekLayout");
    expect(html).toContain("desktopWeekScroller");
    expect(html).toContain("Sep 7–13, 2026");
  });

  it("renders agenda view with chronological days and items", () => {
    const html = renderToStaticMarkup(
      <CalendarWorkspace
        {...defaultProps}
        view="agenda"
        heading="Next 30 days · Sep 11"
        fromDate="2026-09-11"
        toDateExclusive="2026-10-11"
      />,
    );
    expect(html).toContain("agenda");
    expect(html).toContain("Team Retrospective");
    expect(html).toContain("Algorithms Lecture");
  });

  it("renders legend popover trigger with accessible name", () => {
    const html = renderToStaticMarkup(<CalendarWorkspace {...defaultProps} />);
    expect(html).toContain("Calendar legend");
  });

  it("supports action buttons for New Event and Plan Work", () => {
    const html = renderToStaticMarkup(<CalendarWorkspace {...defaultProps} />);
    expect(html).toContain("New event");
    expect(html).toContain("Plan work");
  });
});
