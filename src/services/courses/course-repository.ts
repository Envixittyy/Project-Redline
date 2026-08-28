import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import type { Course, CourseWithMeetings, PersistedCourseMeeting } from "@/types/course";
import type { CourseMeeting } from "@/types/course-meeting";

type CourseRow = {
  id: string; code: string; name: string; instructor: string | null;
  location: string | null; color: string | null; archived_at: string | null;
};
type MeetingRow = {
  id: string; course_id: string; title: string; weekdays: number[];
  start_date: string; end_date_exclusive: string | null; start_time: string;
  end_time: string; time_zone: string; location: string | null;
};

export class CourseRepositoryError extends Error {
  constructor(message: string, readonly detail?: PostgrestError) {
    super(message); this.name = "CourseRepositoryError";
  }
}

function fail(action: string, error: PostgrestError): never {
  console.error(`[courses] ${action} failed:`, error);
  throw new CourseRepositoryError(`Could not ${action}. Please try again.`, error);
}

const toCourse = (row: CourseRow): Course => ({
  id: row.id, code: row.code, name: row.name, instructor: row.instructor,
  location: row.location, color: row.color, archivedAt: row.archived_at,
});
const toMeeting = (row: MeetingRow): PersistedCourseMeeting => ({
  id: row.id, courseId: row.course_id, title: row.title, weekdays: row.weekdays,
  startDate: row.start_date, endDateExclusive: row.end_date_exclusive,
  startTime: row.start_time.slice(0, 5), endTime: row.end_time.slice(0, 5),
  timeZone: row.time_zone, location: row.location,
});

export async function listCourses(): Promise<CourseWithMeetings[]> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const [courses, meetings] = await Promise.all([
    client.from("courses").select("id,code,name,instructor,location,color,archived_at").eq("user_id", userId).is("archived_at", null).order("code"),
    client.from("course_meetings").select("id,course_id,title,weekdays,start_date,end_date_exclusive,start_time,end_time,time_zone,location").eq("user_id", userId).order("start_time"),
  ]);
  if (courses.error) fail("load courses", courses.error);
  if (meetings.error) fail("load course meetings", meetings.error);
  const grouped = new Map<string, PersistedCourseMeeting[]>();
  for (const row of meetings.data as MeetingRow[]) {
    const values = grouped.get(row.course_id) ?? [];
    values.push(toMeeting(row)); grouped.set(row.course_id, values);
  }
  return (courses.data as CourseRow[]).map((row) => ({ ...toCourse(row), meetings: grouped.get(row.id) ?? [] }));
}

export async function listCourseMeetingsForCalendar(): Promise<CourseMeeting[]> {
  return (await listCourses()).flatMap((course) => course.meetings.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    course: { id: course.id, label: `${course.code} · ${course.name}`, color: course.color },
    weekdays: meeting.weekdays.filter((day): day is 0|1|2|3|4|5|6 => Number.isInteger(day) && day >= 0 && day <= 6),
    startDate: meeting.startDate,
    endDateExclusive: meeting.endDateExclusive,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    timeZone: meeting.timeZone,
  })));
}

export type CourseDraft = Omit<Course, "id" | "archivedAt">;
export async function createCourse(draft: CourseDraft): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { error } = await client.from("courses").insert({
    user_id: userId, code: draft.code, name: draft.name, instructor: draft.instructor,
    location: draft.location, color: draft.color,
  });
  if (error) fail("create the course", error);
}

export async function updateCourse(id: string, draft: CourseDraft): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("courses").update({
    code: draft.code, name: draft.name, instructor: draft.instructor,
    location: draft.location, color: draft.color,
  }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) fail("update the course", error);
  if (!data) throw new CourseRepositoryError("That course no longer exists.");
}

export async function archiveCourse(id: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("courses").update({ archived_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) fail("archive the course", error);
  if (!data) throw new CourseRepositoryError("That course no longer exists.");
}

export type MeetingDraft = Omit<PersistedCourseMeeting, "id">;
export async function saveMeeting(id: string | null, draft: MeetingDraft): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const row = { user_id: userId, course_id: draft.courseId, title: draft.title, weekdays: draft.weekdays,
    start_date: draft.startDate, end_date_exclusive: draft.endDateExclusive, start_time: draft.startTime,
    end_time: draft.endTime, time_zone: draft.timeZone, location: draft.location };
  const query = id
    ? client.from("course_meetings").update(row).eq("id", id).eq("user_id", userId)
    : client.from("course_meetings").insert(row);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) fail(id ? "update the meeting" : "create the meeting", error);
  if (!data) throw new CourseRepositoryError("That meeting could not be saved.");
}

export async function deleteMeeting(id: string): Promise<void> {
  const { client, userId } = await requireAuthenticatedSupabase();
  const { data, error } = await client.from("course_meetings").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) fail("delete the meeting", error);
  if (!data) throw new CourseRepositoryError("That meeting no longer exists.");
}

