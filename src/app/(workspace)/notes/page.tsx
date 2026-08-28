import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { NoteWorkspace } from "@/features/notes/note-workspace";
import { listCourses } from "@/services/courses/course-repository";
import { listNotes } from "@/services/notes/note-repository";
import { listTaskLinkOptions } from "@/services/tasks/task-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";

export const metadata:Metadata={title:"Notes"};
export default async function NotesPage({searchParams}:PageProps<"/notes">){const params=await searchParams;const raw=Array.isArray(params.q)?params.q[0]:params.q;const q=typeof raw==="string"?raw.slice(0,100):"";if(!isSupabaseConfigured())return <><PageHeader title="Notes" description="Private Markdown notes with reliable saving, task and course links, search, and authenticated attachments."/><Surface variant="glass" style={{padding:"1rem"}}><h2>Connect Supabase to use Notes</h2><p>Apply the Phase 1 foundation migration to create private notes and attachment storage.</p></Surface></>;const [notes,courses,tasks]=await Promise.all([listNotes(q),listCourses(),listTaskLinkOptions()]);return <><PageHeader title="Notes" description="Private Markdown notes with reliable saving, task and course links, search, and authenticated attachments."/><NoteWorkspace notes={notes} courses={courses} tasks={tasks} initialSearch={q}/></>}
