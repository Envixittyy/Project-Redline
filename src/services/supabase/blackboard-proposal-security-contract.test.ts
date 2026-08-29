import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260829230000_blackboard_task_proposals.sql");

describe("Phase 7A: Blackboard Proposal Security and Integrity Contract", () => {
  it("enforces owner-checked course_id on tasks and external_records", () => {
    expect(migration).toContain("alter table public.tasks");
    expect(migration).toContain("add column if not exists course_id uuid references public.courses(id)");
    expect(migration).toContain("alter table public.external_records");
    expect(migration).toContain("create or replace function public.enforce_task_relationship_owner");
    expect(migration).toContain("course must belong to the task owner");
    expect(migration).toContain("create or replace function public.enforce_external_record_relationship_owner");
    expect(migration).toContain("course must belong to the external record owner");
  });

  it("adds partial uniqueness indexes preventing duplicate proposals and multi-claimed native tasks", () => {
    expect(migration).toContain("create unique index if not exists external_records_owner_task_unique");
    expect(migration).toContain("on public.external_records (user_id, task_id)");
    expect(migration).toContain("where task_id is not null");

    expect(migration).toContain("create unique index if not exists capture_proposals_owner_external_record_action_unique");
    expect(migration).toContain("on public.capture_proposals (user_id, external_record_id, action_type)");
    expect(migration).toContain("where external_record_id is not null");
  });

  it("provides security-invoker reconciliation RPC without service_role privileges", () => {
    expect(migration).toContain("create or replace function public.reconcile_blackboard_proposal");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("grant execute on function public.reconcile_blackboard_proposal");
    expect(migration).not.toContain("service_role");
  });

  it("provides dismiss and acknowledge RPCs for user proposal lifecycle", () => {
    expect(migration).toContain("create or replace function public.dismiss_capture_proposal");
    expect(migration).toContain("create or replace function public.acknowledge_proposal_divergence");
    expect(migration).toContain("grant execute on function public.dismiss_capture_proposal(uuid) to authenticated");
    expect(migration).toContain("grant execute on function public.acknowledge_proposal_divergence(uuid) to authenticated");
  });

  it("extends commit_capture_task to validate external record state and atomically link task", () => {
    expect(migration).toContain("create or replace function public.commit_capture_task");
    expect(migration).toContain("proposal_row.source_revision is distinct from ext_record.proposal_revision");
    expect(migration).toContain("external item changed and must be refreshed before confirmation");
    expect(migration).toContain("ext_record.missing_since is not null");
    expect(migration).toContain("external item is missing and cannot be confirmed");
    expect(migration).toContain("set task_id = new_task_id");
  });

  it("extends undo_capture_task to unlink external record on safe task deletion", () => {
    expect(migration).toContain("create or replace function public.undo_capture_task");
    expect(migration).toContain("update public.external_records");
    expect(migration).toContain("set task_id = null");
    expect(migration).toContain("where task_id = target_task_id");
  });
});
