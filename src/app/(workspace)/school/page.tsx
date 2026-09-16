import type { Metadata } from "next";

import { SchoolWorkspace } from "@/features/school/school-workspace";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCourses } from "@/services/courses/course-repository";
import { listSchoolItems } from "@/services/school/school-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = { title: "School" };

type SchoolPageProps = {
  searchParams?: Promise<{ course?: string }>;
};

export default async function SchoolPage({ searchParams }: SchoolPageProps) {
  const params = searchParams ? await searchParams : {};
  const initialCourseId = typeof params.course === "string" ? params.course : null;
  const timeZone = resolveTimeZone();

  // Critical path: render primary course/workspace content first
  const [courses, schoolItems] = isSupabaseConfigured()
    ? await Promise.all([
        listCourses().catch(() => []),
        listSchoolItems().catch(() => []),
      ])
    : [[], []];

  return (
    <SchoolWorkspace
      courses={courses}
      schoolItems={schoolItems}
      today={todayIn(timeZone)}
      timeZone={timeZone}
      initialCourseId={initialCourseId}
    />
  );
}
