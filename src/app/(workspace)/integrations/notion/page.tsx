import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { NotionPanel } from "@/features/integrations/notion-panel";
import {
  getNotionAccountStatus,
  getNotionSyncConflict,
  listNotionPageLinks,
} from "@/services/integrations/notion/notion-repository";
import { listNotes } from "@/services/notes/note-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import type { NotionSyncConflict } from "@/services/integrations/notion/types";

export const metadata: Metadata = { title: "Notion integration" };

export default async function NotionIntegrationPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader
          title="Notion"
          description="Selective two-way note synchronization and export."
        />
        <Surface variant="glass" style={{ padding: "1rem" }}>
          Configure Supabase before connecting Notion.
        </Surface>
      </>
    );
  }

  const [status, links, notes] = await Promise.all([
    getNotionAccountStatus(),
    listNotionPageLinks(),
    listNotes(),
  ]);

  const conflicts: NotionSyncConflict[] = [];
  for (const link of links) {
    if (link.status === "conflict") {
      const conflict = await getNotionSyncConflict(link.id);
      if (conflict) conflicts.push(conflict);
    }
  }

  return (
    <>
      <PageHeader
        title="Notion"
        description="Selective two-way knowledge synchronization, export, and conflict management."
      />
      <NotionPanel
        status={status}
        links={links}
        conflicts={conflicts}
        notes={notes.map((n) => ({ id: n.id, title: n.title }))}
      />
    </>
  );
}
