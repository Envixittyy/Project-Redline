import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { HomeDashboard } from "@/features/home/home-dashboard";
import { listCourses } from "@/services/courses/course-repository";
import { listTasksForView } from "@/services/tasks/task-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const configured=isSupabaseConfigured();
  const [today,overdue,upcoming,courses]=configured?await Promise.all([listTasksForView("today"),listTasksForView("overdue"),listTasksForView("next7"),listCourses()]):[[],[],[],[]];
  return (
    <>
      <PageHeader
        eyebrow="Your space"
        title="A calmer place for everything."
        description="Today’s commitments, overdue work, upcoming deadlines, courses, and notes—drawn from your private workspace data."
      />
      {configured?<HomeDashboard today={today} overdue={overdue} upcoming={upcoming} courses={courses}/>:<Surface variant="glass" style={{padding:"1rem"}}><h2>Connect Supabase to load Home</h2><p>Configure the public Supabase URL and publishable key, then apply the migrations. No demo data is inserted automatically.</p></Surface>}
    </>
  );
}
