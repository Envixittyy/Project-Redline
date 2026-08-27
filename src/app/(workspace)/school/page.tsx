import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export const metadata: Metadata = { title: "School" };

export default function SchoolPage() {
  return (
    <>
      <PageHeader title="School" description="A dedicated place for academic priorities and calendar-related school information." />
      <SectionPlaceholder icon={GraduationCap} phase="Phase 1F" title="School stays intentionally quiet" description="Courses, Blackboard calendar data, and academic organization are not implemented in this phase." />
    </>
  );
}
