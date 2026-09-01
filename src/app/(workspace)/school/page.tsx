import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { SchoolWorkspace } from "@/features/school/school-workspace";
import { resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCourseMaterials } from "@/services/course-materials/course-material-repository";
import { listCourses } from "@/services/courses/course-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import { listAcademicCalendarSources } from "@/services/integrations/ai/academic-calendar-repository";

export const metadata: Metadata = { title: "School" };

export default async function SchoolPage() {
  const timeZone = resolveTimeZone();
  const [courses, materials, academicCalendarSources] = isSupabaseConfigured()
    ? await Promise.all([listCourses(), listCourseMaterials(), listAcademicCalendarSources()])
    : [[], [], []];

  return (
    <>
      <PageHeader
        title="School"
        description="Courses, recurring timetable meetings, and course materials stay owner-scoped and project directly to Home and Calendar."
      />
      <SchoolWorkspace
        courses={courses}
        materials={materials}
        today={todayIn(timeZone)}
        timeZone={timeZone}
        academicCalendarSources={academicCalendarSources}
      />
    </>
  );
}
