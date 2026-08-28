export type Course = {
  id: string;
  code: string;
  name: string;
  instructor: string | null;
  location: string | null;
  color: string | null;
  archivedAt: string | null;
};

export type PersistedCourseMeeting = {
  id: string;
  courseId: string;
  title: string;
  weekdays: number[];
  startDate: string;
  endDateExclusive: string | null;
  startTime: string;
  endTime: string;
  timeZone: string;
  location: string | null;
};

export type CourseWithMeetings = Course & { meetings: PersistedCourseMeeting[] };

