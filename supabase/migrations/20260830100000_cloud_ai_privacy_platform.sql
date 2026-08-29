-- Phase 9: Cloud AI Privacy Platform & Metadata Transfer Audit Migration
-- Implements owner-scoped ai_preferences, ai_transfer_requests,
-- operation_batches extensions, owner equality checks, and security-invoker RPCs.

-- 1. Create ai_preferences table
create table if not exists public.ai_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cloud_enabled boolean not null default false,
  default_provider text check (default_provider is null or default_provider in ('anthropic', 'gemini', 'openai')),
  text_model text,
  vision_model text,
  embedding_model text,
  cloud_fallback_mode text not null default 'ask_each_time',
  permission_mode text not null default 'ask_before_changing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_preferences_user_unique unique (user_id),
  constraint ai_preferences_cloud_fallback_mode check (
    cloud_fallback_mode in ('off', 'ask_each_time', 'automatic_on_low_confidence')
  ),
  constraint ai_preferences_permission_mode check (
    permission_mode in ('suggest_only', 'ask_before_changing', 'trusted_automation')
  )
);

-- 2. Extend operation_batches status to include 'rejected' and add ai_transfer_request_id reference
alter table public.operation_batches
  drop constraint if exists operation_batches_status;

alter table public.operation_batches
  add constraint operation_batches_status check (
    status in ('proposed', 'confirmed', 'committed', 'undone', 'failed', 'rejected')
  );

-- 3. Create ai_transfer_requests table
create table if not exists public.ai_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,
  model text not null,
  purpose text not null,
  capability text not null,
  data_classes text[] not null,
  source_count integer not null default 0,
  text_byte_count integer not null default 0,
  image_byte_count integer not null default 0,
  allow_listed_fields text[] not null default '{}'::text[],
  source_references jsonb not null default '[]'::jsonb,
  canonical_payload_digest text not null,
  status text not null default 'awaiting_consent',
  operation_batch_id uuid references public.operation_batches(id) on delete set null,
  error_code text,
  consented_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  audit_expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_transfer_requests_provider check (provider in ('anthropic', 'gemini', 'openai')),
  constraint ai_transfer_requests_capability check (
    capability in ('text', 'vision', 'embeddings', 'tools', 'structured_output')
  ),
  constraint ai_transfer_requests_status check (
    status in ('awaiting_consent', 'consented', 'dispatching', 'succeeded', 'failed', 'cancelled', 'expired')
  ),
  constraint ai_transfer_requests_counts check (
    source_count >= 0 and text_byte_count >= 0 and image_byte_count >= 0
  ),
  constraint ai_transfer_requests_digest_format check (
    length(canonical_payload_digest) = 64
  )
);

-- Foreign key on operation_batches to ai_transfer_requests
alter table public.operation_batches
  add column if not exists ai_transfer_request_id uuid references public.ai_transfer_requests(id) on delete set null;

-- Indexes for performance, status inspection, and audit expiration
create index if not exists ai_preferences_user_idx
  on public.ai_preferences (user_id);

create index if not exists ai_transfer_requests_owner_status_idx
  on public.ai_transfer_requests (user_id, status, created_at desc);

create index if not exists ai_transfer_requests_audit_expires_idx
  on public.ai_transfer_requests (audit_expires_at)
  where audit_expires_at is not null;

create index if not exists operation_batches_ai_transfer_idx
  on public.operation_batches (ai_transfer_request_id)
  where ai_transfer_request_id is not null;

-- 4. Updated_at triggers
create trigger ai_preferences_updated
  before update on public.ai_preferences
  for each row execute function public.set_updated_at();

create trigger ai_transfer_requests_updated
  before update on public.ai_transfer_requests
  for each row execute function public.set_updated_at();

-- 5. Owner equality enforcement triggers
create or replace function public.enforce_ai_transfer_batch_owner()
returns trigger
language plpgsql
security invoker
as $$
declare
  batch_owner uuid;
begin
  if new.operation_batch_id is not null then
    select user_id into batch_owner from public.operation_batches where id = new.operation_batch_id;
    if batch_owner is null or batch_owner <> new.user_id then
      raise exception 'Operation batch must belong to the transfer request owner';
    end if;
  end if;
  return new;
end;
$$;

create trigger ai_transfer_requests_batch_owner_check
  before insert or update on public.ai_transfer_requests
  for each row execute function public.enforce_ai_transfer_batch_owner();

create or replace function public.enforce_operation_batch_ai_transfer_owner()
returns trigger
language plpgsql
security invoker
as $$
declare
  transfer_owner uuid;
begin
  if new.ai_transfer_request_id is not null then
    select user_id into transfer_owner from public.ai_transfer_requests where id = new.ai_transfer_request_id;
    if transfer_owner is null or transfer_owner <> new.user_id then
      raise exception 'AI transfer request must belong to the operation batch owner';
    end if;
  end if;
  return new;
end;
$$;

create trigger operation_batch_ai_transfer_owner_check
  before insert or update on public.operation_batches
  for each row execute function public.enforce_operation_batch_ai_transfer_owner();

-- 6. Row Level Security policies
alter table public.ai_preferences enable row level security;
alter table public.ai_transfer_requests enable row level security;

create policy ai_preferences_select_own on public.ai_preferences
  for select to authenticated using ((select auth.uid()) = user_id);

create policy ai_preferences_insert_own on public.ai_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy ai_preferences_update_own on public.ai_preferences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy ai_preferences_delete_own on public.ai_preferences
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy ai_transfer_requests_select_own on public.ai_transfer_requests
  for select to authenticated using ((select auth.uid()) = user_id);

create policy ai_transfer_requests_insert_own on public.ai_transfer_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy ai_transfer_requests_update_own on public.ai_transfer_requests
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy ai_transfer_requests_delete_own on public.ai_transfer_requests
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 7. Security-Invoker RPCs for Privacy-Gated State Machine

-- Prepare transfer metadata
create or replace function public.ai_prepare_transfer_request(
  p_provider text,
  p_model text,
  p_purpose text,
  p_capability text,
  p_data_classes text[],
  p_source_count integer,
  p_text_byte_count integer,
  p_image_byte_count integer,
  p_allow_listed_fields text[],
  p_source_references jsonb,
  p_canonical_payload_digest text
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  transfer_id uuid := gen_random_uuid();
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.ai_transfer_requests (
    id,
    user_id,
    provider,
    model,
    purpose,
    capability,
    data_classes,
    source_count,
    text_byte_count,
    image_byte_count,
    allow_listed_fields,
    source_references,
    canonical_payload_digest,
    status,
    expires_at,
    audit_expires_at
  ) values (
    transfer_id,
    actor_id,
    p_provider,
    p_model,
    p_purpose,
    p_capability,
    p_data_classes,
    p_source_count,
    p_text_byte_count,
    p_image_byte_count,
    p_allow_listed_fields,
    p_source_references,
    p_canonical_payload_digest,
    'awaiting_consent',
    now() + interval '5 minutes',
    now() + interval '30 days'
  );

  return jsonb_build_object(
    'ok', true,
    'transfer_id', transfer_id,
    'expires_at', (now() + interval '5 minutes')
  );
end;
$$;

-- Grant one-time consent for exact transfer ID
create or replace function public.ai_grant_transfer_consent(p_transfer_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  row_count integer;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.ai_transfer_requests
  set status = 'consented',
      consented_at = now()
  where id = p_transfer_id
    and user_id = actor_id
    and status = 'awaiting_consent'
    and expires_at > now();

  get diagnostics row_count = row_count;
  if row_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'transfer_not_eligible_or_expired');
  end if;

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id);
end;
$$;

-- Atomic dispatch claim (moves consented -> dispatching after verifying payload digest)
create or replace function public.ai_claim_transfer_dispatch(
  p_transfer_id uuid,
  p_canonical_payload_digest text
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  req_row public.ai_transfer_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into req_row
  from public.ai_transfer_requests
  where id = p_transfer_id and user_id = actor_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'transfer_not_found');
  end if;

  if req_row.status <> 'consented' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status_for_dispatch', 'current_status', req_row.status);
  end if;

  if req_row.expires_at <= now() then
    update public.ai_transfer_requests set status = 'expired' where id = p_transfer_id;
    return jsonb_build_object('ok', false, 'error', 'consent_expired');
  end if;

  if req_row.canonical_payload_digest <> p_canonical_payload_digest then
    return jsonb_build_object('ok', false, 'error', 'payload_digest_mismatch');
  end if;

  update public.ai_transfer_requests
  set status = 'dispatching',
      claimed_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id);
end;
$$;

-- Complete or fail transfer request
create or replace function public.ai_complete_transfer_request(
  p_transfer_id uuid,
  p_status text,
  p_error_code text,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  req_row public.ai_transfer_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_status not in ('succeeded', 'failed') then
    raise exception 'Invalid completion status';
  end if;

  select * into req_row
  from public.ai_transfer_requests
  where id = p_transfer_id and user_id = actor_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'transfer_not_found');
  end if;

  if req_row.status <> 'dispatching' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status_for_completion', 'current_status', req_row.status);
  end if;

  update public.ai_transfer_requests
  set status = p_status,
      error_code = p_error_code,
      operation_batch_id = p_batch_id,
      completed_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id);
end;
$$;

-- Cancel transfer request
create or replace function public.ai_cancel_transfer_request(p_transfer_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.ai_transfer_requests
  set status = 'cancelled'
  where id = p_transfer_id
    and user_id = actor_id
    and status in ('awaiting_consent', 'consented');

  return jsonb_build_object('ok', true, 'transfer_id', p_transfer_id);
end;
$$;

-- Clear transfer metadata history
create or replace function public.ai_clear_transfer_history()
returns jsonb
language plpgsql
security invoker
as $$
declare
  actor_id uuid := auth.uid();
  deleted_count integer;
begin
  if actor_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.ai_transfer_requests
  where user_id = actor_id
    and status in ('succeeded', 'failed', 'cancelled', 'expired');

  get diagnostics deleted_count = row_count;
  return jsonb_build_object('ok', true, 'deleted_count', deleted_count);
end;
$$;

-- Purge expired transfer audit records (older than 30 days)
create or replace function public.ai_purge_expired_transfers()
returns integer
language plpgsql
security invoker
as $$
declare
  purged_count integer;
begin
  delete from public.ai_transfer_requests
  where audit_expires_at <= now()
     or (status in ('awaiting_consent', 'consented') and expires_at <= now() - interval '1 day');

  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

-- Grants
grant execute on function public.ai_prepare_transfer_request to authenticated;
grant execute on function public.ai_grant_transfer_consent to authenticated;
grant execute on function public.ai_claim_transfer_dispatch to authenticated;
grant execute on function public.ai_complete_transfer_request to authenticated;
grant execute on function public.ai_cancel_transfer_request to authenticated;
grant execute on function public.ai_clear_transfer_history to authenticated;
grant execute on function public.ai_purge_expired_transfers to authenticated;
