import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = file("supabase/migrations/20260830100000_cloud_ai_privacy_platform.sql");

describe("Phase 9: Cloud AI Privacy Security and Integrity Contract", () => {
  it("defines ai_preferences and ai_transfer_requests with owner-scoped RLS and constraints", () => {
    expect(migration).toContain("create table if not exists public.ai_preferences");
    expect(migration).toContain("create table if not exists public.ai_transfer_requests");
    expect(migration).toContain("alter table public.ai_preferences enable row level security");
    expect(migration).toContain("alter table public.ai_transfer_requests enable row level security");
    expect(migration).toContain("constraint ai_preferences_user_unique unique (user_id)");
    expect(migration).toContain("cloud_enabled boolean not null default false");
  });

  it("adds transfer status constraints, byte counts, and strict 64-character SHA-256 digest checks", () => {
    expect(migration).toContain("constraint ai_transfer_requests_status check");
    expect(migration).toContain("'awaiting_consent', 'consented', 'dispatching', 'succeeded', 'failed', 'cancelled', 'expired'");
    expect(migration).toContain("constraint ai_transfer_requests_counts check");
    expect(migration).toContain("constraint ai_transfer_requests_digest_format check");
    expect(migration).toContain("length(canonical_payload_digest) = 64");
  });

  it("extends operation_batches status to include 'rejected' and links to ai_transfer_requests", () => {
    expect(migration).toContain("status in ('proposed', 'confirmed', 'committed', 'undone', 'failed', 'rejected')");
    expect(migration).toContain("add column if not exists ai_transfer_request_id uuid");
  });

  it("enforces owner equality across transfer requests and operation batches", () => {
    expect(migration).toContain("create or replace function public.enforce_ai_transfer_batch_owner");
    expect(migration).toContain("Operation batch must belong to the transfer request owner");
    expect(migration).toContain("create or replace function public.enforce_operation_batch_ai_transfer_owner");
    expect(migration).toContain("AI transfer request must belong to the operation batch owner");
  });

  it("provides security-invoker privacy state-machine RPCs granted only to authenticated", () => {
    expect(migration).toContain("create or replace function public.ai_prepare_transfer_request");
    expect(migration).toContain("create or replace function public.ai_grant_transfer_consent");
    expect(migration).toContain("create or replace function public.ai_claim_transfer_dispatch");
    expect(migration).toContain("create or replace function public.ai_complete_transfer_request");
    expect(migration).toContain("create or replace function public.ai_cancel_transfer_request");
    expect(migration).toContain("create or replace function public.ai_clear_transfer_history");
    expect(migration).toContain("create or replace function public.ai_purge_expired_transfers");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("grant execute on function public.ai_grant_transfer_consent to authenticated");
    expect(migration).not.toContain("to service_role");
  });
});
