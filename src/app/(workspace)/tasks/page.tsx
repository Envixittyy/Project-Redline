import type { Metadata } from "next";
import { ListTodo } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { SectionPlaceholder } from "@/components/ui/section-placeholder";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <>
      <PageHeader title="Tasks" description="A focused home for what needs doing, without turning every commitment into a calendar event." />
      <SectionPlaceholder icon={ListTodo} phase="Phase 1C" title="Task planning starts next" description="Task capture, projects, scheduling, and persistence will be designed in the next phase." />
    </>
  );
}
