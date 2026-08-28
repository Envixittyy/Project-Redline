import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { SchoolWorkspace } from "@/features/school/school-workspace";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCourses } from "@/services/courses/course-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = { title: "School" };

export default async function SchoolPage() {
  const timeZone=resolveTimeZone();
  const courses=isSupabaseConfigured()?await listCourses():[];
  return (
    <>
      <PageHeader title="School" description="Courses and recurring meetings stay owner-scoped and appear on the timetable without becoming ordinary calendar events." />
      <SchoolWorkspace courses={courses} today={todayIn(timeZone)} timeZone={timeZone}/>
    </>
  );
}
