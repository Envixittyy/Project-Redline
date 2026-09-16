import type { Metadata } from "next";

import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { NoteWorkspace } from "@/features/notes/note-workspace";
import { listCourses } from "@/services/courses/course-repository";
import { listNotes } from "@/services/notes/note-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata: Metadata = { title: "Notes" };
export default async function NotesPage({ searchParams }: PageProps<"/notes">) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = typeof raw === "string" ? raw.slice(0, 100) : "";

  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader
          title="Notes"
          description="Private Markdown notes with reliable saving, task and course links, search, and authenticated attachments."
        />
        <Callout variant="warning" title="Connect Supabase to use Notes">
          Apply the Phase 1 foundation migration to create private notes and attachment storage.
        </Callout>
      </>
    );
  }

  // Critical path: render notes list and editor immediately
  // Task link options are deferred until link UI is opened; Notion integration stays off critical path
  const [notes, courses] = await Promise.all([
    listNotes(q),
    listCourses(),
  ]);

  return (
    <NoteWorkspace
      notes={notes}
      courses={courses}
      initialSearch={q}
    />
  );
}
