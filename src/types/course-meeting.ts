/**
 * Minimal calendar-facing course identity for Phase 1F. Courses and meetings
 * are not persisted yet; the School phase can adapt its model to this shape.
 */
export type CourseCalendarIdentity = {
  id: string;
  label: string;
  color: string | null;
};

export type CourseWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Weekly recurrence bounded by local calendar dates in the meeting's zone. */
export type CourseMeeting = {
  id: string;
  title: string;
  course: CourseCalendarIdentity;
  weekdays: readonly CourseWeekday[];
  startDate: string;
  endDateExclusive: string | null;
  startTime: string;
  endTime: string;
  timeZone: string;
};
