import type { CourseWithMeetings } from "@/types/course";
import type { SchoolEmailEvent, SchoolItem } from "@/types/school-item";

export function findSchoolEventCourse(
  event: SchoolEmailEvent,
  courses: CourseWithMeetings[],
): CourseWithMeetings | undefined {
  return event.courseId ? courses.find((course) => course.id === event.courseId) : undefined;
}

export function schoolEventBelongsToCourse(event: SchoolEmailEvent, courseId: string): boolean {
  return event.courseId === courseId;
}

export function isSchoolItemTaskCompleted(item: SchoolItem): boolean {
  return item.taskStatus === "completed";
}
