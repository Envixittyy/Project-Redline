import { addDays, fromZonedInputValue, isIsoDate, todayIn } from "@/lib/date/day";
import type { CourseWithMeetings } from "@/types/course";

export type ClassMeetingOccurrence = {
  meetingId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  courseColor: string | null;
  meetingTitle: string;
  location: string | null;
  date: string; // YYYY-MM-DD
  startInstant: string; // ISO 8601 UTC string
  endInstant: string;   // ISO 8601 UTC string
  startTimeFormatted: string; // e.g. "10:30 AM"
  endTimeFormatted: string;   // e.g. "12:00 PM"
  timeRangeFormatted: string; // e.g. "10:30 AM – 12:00 PM"
  status: "past" | "in_progress" | "upcoming";
  relativeTimeText: string;
  startsInMinutes: number; // Negative if past/in progress
  remainingMinutes: number; // Negative if past
};

export type NextClassResult =
  | { kind: "in_progress"; occurrence: ClassMeetingOccurrence }
  | { kind: "upcoming"; occurrence: ClassMeetingOccurrence }
  | { kind: "no_more_today"; nextOccurrence: ClassMeetingOccurrence | null }
  | { kind: "none_today"; nextOccurrence: ClassMeetingOccurrence | null }
  | { kind: "none_configured" };

function weekdayFor(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function formatTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

const wallTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Projects a single meeting on a specific date into an occurrence if it falls on an active weekday and within valid dates.
 */
function buildOccurrenceForDate(
  course: CourseWithMeetings,
  meeting: CourseWithMeetings["meetings"][number],
  targetDate: string,
  timeZone: string,
  now: Date,
): ClassMeetingOccurrence | null {
  if (course.archivedAt) return null;
  if (!isIsoDate(targetDate)) return null;
  if (!isIsoDate(meeting.startDate)) return null;
  if (targetDate < meeting.startDate) return null;
  if (meeting.endDateExclusive && targetDate >= meeting.endDateExclusive) return null;

  const weekdays = new Set<number>(meeting.weekdays);
  if (!weekdays.has(weekdayFor(targetDate))) return null;

  if (!wallTimePattern.test(meeting.startTime) || !wallTimePattern.test(meeting.endTime)) {
    return null;
  }

  const meetingTz = meeting.timeZone || timeZone;
  const endDate = meeting.endTime > meeting.startTime ? targetDate : addDays(targetDate, 1);

  let startInstant: string;
  let endInstant: string;

  try {
    startInstant = fromZonedInputValue(`${targetDate}T${meeting.startTime}`, meetingTz);
    endInstant = fromZonedInputValue(`${endDate}T${meeting.endTime}`, meetingTz);
  } catch {
    return null;
  }

  const startMs = Date.parse(startInstant);
  const endMs = Date.parse(endInstant);
  const nowMs = now.getTime();

  let status: ClassMeetingOccurrence["status"] = "upcoming";
  if (nowMs >= endMs) {
    status = "past";
  } else if (nowMs >= startMs && nowMs < endMs) {
    status = "in_progress";
  }

  const startsInMinutes = Math.round((startMs - nowMs) / 60_000);
  const remainingMinutes = Math.round((endMs - nowMs) / 60_000);

  let relativeTimeText = "";
  if (status === "in_progress") {
    if (remainingMinutes <= 1) {
      relativeTimeText = "Ending now";
    } else if (remainingMinutes < 60) {
      relativeTimeText = `In progress · Ends in ${remainingMinutes}m`;
    } else {
      const h = Math.floor(remainingMinutes / 60);
      const m = remainingMinutes % 60;
      relativeTimeText = `In progress · Ends in ${h}h ${m > 0 ? `${m}m` : ""}`.trim();
    }
  } else if (status === "upcoming") {
    if (startsInMinutes <= 0) {
      relativeTimeText = "Starting now";
    } else if (startsInMinutes < 60) {
      relativeTimeText = `Starts in ${startsInMinutes}m`;
    } else if (startsInMinutes < 24 * 60) {
      const h = Math.floor(startsInMinutes / 60);
      const m = startsInMinutes % 60;
      relativeTimeText = `Starts in ${h}h ${m > 0 ? `${m}m` : ""}`.trim();
    } else {
      relativeTimeText = `Starts ${targetDate}`;
    }
  } else {
    relativeTimeText = "Completed";
  }

  const startTimeFormatted = formatTime(startInstant, timeZone);
  const endTimeFormatted = formatTime(endInstant, timeZone);
  const timeRangeFormatted = `${startTimeFormatted} – ${endTimeFormatted}`;
  const location = meeting.location?.trim() || course.location?.trim() || null;

  return {
    meetingId: meeting.id,
    courseId: course.id,
    courseCode: course.code,
    courseName: course.name,
    courseColor: course.color,
    meetingTitle: meeting.title,
    location,
    date: targetDate,
    startInstant,
    endInstant,
    startTimeFormatted,
    endTimeFormatted,
    timeRangeFormatted,
    status,
    relativeTimeText,
    startsInMinutes,
    remainingMinutes,
  };
}

/**
 * Projects all canonical course meetings for today in chronological order.
 */
export function projectTodayClasses(
  courses: CourseWithMeetings[],
  timeZone: string,
  now: Date = new Date(),
): ClassMeetingOccurrence[] {
  const todayDate = todayIn(timeZone, now);
  const occurrences: ClassMeetingOccurrence[] = [];

  for (const course of courses) {
    if (course.archivedAt) continue;
    for (const meeting of course.meetings) {
      const occurrence = buildOccurrenceForDate(course, meeting, todayDate, timeZone, now);
      if (occurrence) {
        occurrences.push(occurrence);
      }
    }
  }

  return occurrences.sort((a, b) => {
    const startDiff = Date.parse(a.startInstant) - Date.parse(b.startInstant);
    if (startDiff !== 0) return startDiff;
    const endDiff = Date.parse(a.endInstant) - Date.parse(b.endInstant);
    if (endDiff !== 0) return endDiff;
    return a.courseCode.localeCompare(b.courseCode);
  });
}

/**
 * Finds the next upcoming class across the next N days (default 7).
 */
export function findNextUpcomingClass(
  courses: CourseWithMeetings[],
  timeZone: string,
  now: Date = new Date(),
  lookaheadDays = 7,
): ClassMeetingOccurrence | null {
  const todayDate = todayIn(timeZone, now);
  const futureOccurrences: ClassMeetingOccurrence[] = [];

  for (let i = 1; i <= lookaheadDays; i++) {
    const futureDate = addDays(todayDate, i);
    for (const course of courses) {
      if (course.archivedAt) continue;
      for (const meeting of course.meetings) {
        const occurrence = buildOccurrenceForDate(course, meeting, futureDate, timeZone, now);
        if (occurrence) {
          futureOccurrences.push(occurrence);
        }
      }
    }
    if (futureOccurrences.length > 0) {
      break; // Found classes on the nearest upcoming school day
    }
  }

  if (futureOccurrences.length === 0) return null;

  return futureOccurrences.sort((a, b) => {
    const startDiff = Date.parse(a.startInstant) - Date.parse(b.startInstant);
    if (startDiff !== 0) return startDiff;
    return a.courseCode.localeCompare(b.courseCode);
  })[0];
}

/**
 * Evaluates the next relevant class state for the Home Next Class card.
 */
export function resolveNextClass(
  courses: CourseWithMeetings[],
  timeZone: string,
  now: Date = new Date(),
): NextClassResult {
  const hasAnyMeetings = courses.some((c) => !c.archivedAt && c.meetings.length > 0);
  if (!hasAnyMeetings) {
    return { kind: "none_configured" };
  }

  const todayClasses = projectTodayClasses(courses, timeZone, now);

  if (todayClasses.length === 0) {
    const nextOccurrence = findNextUpcomingClass(courses, timeZone, now);
    return { kind: "none_today", nextOccurrence };
  }

  // 1. In-progress class takes absolute precedence
  const inProgress = todayClasses.find((c) => c.status === "in_progress");
  if (inProgress) {
    return { kind: "in_progress", occurrence: inProgress };
  }

  // 2. Nearest upcoming class today
  const upcoming = todayClasses.find((c) => c.status === "upcoming");
  if (upcoming) {
    return { kind: "upcoming", occurrence: upcoming };
  }

  // 3. All classes today are completed -> find next class on next school day
  const nextOccurrence = findNextUpcomingClass(courses, timeZone, now);
  return { kind: "no_more_today", nextOccurrence };
}

