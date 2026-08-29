import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260830000000_notion_sync_platform.sql");

describe("Phase 8: Notion Sync Security and Integrity Contract", () => {
  it("defines notion_page_links and notion_sync_conflicts with owner-scoped RLS and restrictions", () => {
    expect(migration).toContain("create table if not exists public.notion_page_links");
    expect(migration).toContain("create table if not exists public.notion_sync_conflicts");
    expect(migration).toContain("alter table public.notion_page_links enable row level security");
    expect(migration).toContain("alter table public.notion_sync_conflicts enable row level security");
    expect(migration).toContain("references public.integration_accounts(id) on delete restrict");
    expect(migration).toContain("references public.notes(id) on delete restrict");
  });

  it("adds partial uniqueness indexes preventing duplicate active links and multi-open conflicts", () => {
    expect(migration).toContain("create unique index if not exists notion_page_links_owner_note_unique");
    expect(migration).toContain("on public.notion_page_links (user_id, note_id)");
    expect(migration).toContain("where retired_at is null");

    expect(migration).toContain("create unique index if not exists notion_page_links_account_remote_page_unique");
    expect(migration).toContain("on public.notion_page_links (account_id, remote_page_id)");
    expect(migration).toContain("where retired_at is null");

    expect(migration).toContain("create unique index if not exists notion_sync_conflicts_one_open_per_link");
    expect(migration).toContain("where status = 'open'");
  });

  it("enforces owner equality across integration_accounts, notes, and links", () => {
    expect(migration).toContain("create or replace function public.enforce_notion_page_link_relationship_owner");
    expect(migration).toContain("Integration account must belong to the notion page link owner");
    expect(migration).toContain("Note must belong to the notion page link owner");
    expect(migration).toContain("create or replace function public.enforce_notion_sync_conflict_relationship_owner");
    expect(migration).toContain("Notion page link must belong to the conflict owner");
  });

  it("attaches note update trigger to mark active links local_pending", () => {
    expect(migration).toContain("create or replace function public.mark_notion_link_local_pending_on_note_update");
    expect(migration).toContain("create trigger note_notion_link_local_pending_trigger");
    expect(migration).toContain("after update on public.notes");
  });

  it("provides security-invoker synchronization and conflict RPCs with authenticated-only grants", () => {
    expect(migration).toContain("create or replace function public.notion_apply_remote_import");
    expect(migration).toContain("create or replace function public.notion_resolve_conflict");
    expect(migration).toContain("create or replace function public.notion_retire_link");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("grant execute on function public.notion_apply_remote_import to authenticated");
    expect(migration).toContain("grant execute on function public.notion_resolve_conflict to authenticated");
    expect(migration).toContain("grant execute on function public.notion_retire_link to authenticated");
    expect(migration).not.toContain("to service_role");
  });
});
