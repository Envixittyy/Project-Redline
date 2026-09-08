import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { SchoolWorkspace } from "@/features/school/school-workspace";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCourseMaterials } from "@/services/course-materials/course-material-repository";
import { listCourses } from "@/services/courses/course-repository";
import {
  listSchoolEmailEvents,
  listSchoolItems,
} from "@/services/school/school-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = { title: "School" };

type SchoolPageProps = {
  searchParams?: Promise<{ course?: string }>;
};

export default async function SchoolPage({ searchParams }: SchoolPageProps) {
  const params = searchParams ? await searchParams : {};
  const initialCourseId = typeof params.course === "string" ? params.course : null;
  const timeZone = resolveTimeZone();
  const [courses, schoolItems, materials, emailEvents] = isSupabaseConfigured()
    ? await Promise.all([
        listCourses().catch(() => []),
        listSchoolItems().catch(() => []),
        listCourseMaterials().catch(() => []),
        listSchoolEmailEvents().catch(() => []),
      ])
    : [[], [], [], []];

  return (
    <>
      <PageHeader
        title="School"
        description="Courses, assignments, timetable meetings, materials, and Blackboard notifications stay owner-scoped and project directly to Home, Tasks, and Calendar."
      />
      <SchoolWorkspace
        courses={courses}
        schoolItems={schoolItems}
        materials={materials}
        emailEvents={emailEvents}
        today={todayIn(timeZone)}
        timeZone={timeZone}
        initialCourseId={initialCourseId}
      />
    </>
  );
}
