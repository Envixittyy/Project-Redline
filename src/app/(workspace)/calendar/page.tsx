import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" description="A future view of events and scheduled tasks, while keeping their underlying domains distinct." />
      <SectionPlaceholder icon={CalendarDays} phase="Phase 1D" title="Time will take shape here" description="Calendar views and source-aware event rendering are intentionally deferred." />
    </>
  );
}
