-- Migration: 20260919100000_dear_dumbass_e2ee_sync.sql
-- Dear Dumbass Phase 3: End-to-End Encrypted Multi-Device Sync
-- Stores only ciphertext, IVs, envelopes, and sync metadata.
-- Zero plaintext bodies, reply bodies, decrypted JSON, or passphrases.

-- 1. Key Envelopes Table (one row per user)
create table if not exists public.dear_dumbass_key_envelopes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  envelope_version integer not null default 1,
  key_version integer not null default 1,
  kdf_algorithm text not null default 'PBKDF2',
  kdf_hash text not null default 'SHA-256',
  kdf_iterations integer not null default 600000,
  salt text not null,
  wrap_iv text not null,
  encrypted_master_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dear_dumbass_key_envelopes enable row level security;

create policy dear_dumbass_key_envelopes_select_own
  on public.dear_dumbass_key_envelopes
  for select
  using ((select auth.uid()) = owner_id);

create policy dear_dumbass_key_envelopes_insert_own
  on public.dear_dumbass_key_envelopes
  for insert
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_key_envelopes_update_own
  on public.dear_dumbass_key_envelopes
  for update
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_key_envelopes_delete_own
  on public.dear_dumbass_key_envelopes
  for delete
  using ((select auth.uid()) = owner_id);

-- 2. Monotonic Change Sequence
create sequence if not exists public.dear_dumbass_records_change_seq;
grant usage, select on sequence public.dear_dumbass_records_change_seq to authenticated;

-- 3. Encrypted Records Table (individually encrypted records)
create table if not exists public.dear_dumbass_encrypted_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id text not null,
  key_version integer not null default 1,
  sync_version integer not null default 1,
  ciphertext text not null,
  iv text not null,
  encryption_format_version integer not null default 1,
  server_change_sequence bigint not null default nextval('public.dear_dumbass_records_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dear_dumbass_encrypted_records_owner_record_unique unique (owner_id, record_id)
);

create index if not exists dear_dumbass_records_cursor_idx
  on public.dear_dumbass_encrypted_records (owner_id, server_change_sequence);

alter table public.dear_dumbass_encrypted_records enable row level security;

create policy dear_dumbass_encrypted_records_select_own
  on public.dear_dumbass_encrypted_records
  for select
  using ((select auth.uid()) = owner_id);

create policy dear_dumbass_encrypted_records_insert_own
  on public.dear_dumbass_encrypted_records
  for insert
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_encrypted_records_update_own
  on public.dear_dumbass_encrypted_records
  for update
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_encrypted_records_delete_own
  on public.dear_dumbass_encrypted_records
  for delete
  using ((select auth.uid()) = owner_id);

-- 4. Atomic CAS Concurrency RPC
create or replace function public.upsert_dear_dumbass_record(
  p_record_id text,
  p_expected_sync_version integer,
  p_key_version integer,
  p_ciphertext text,
  p_iv text,
  p_encryption_format_version integer default 1
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner_id uuid := auth.uid();
  v_existing public.dear_dumbass_encrypted_records%rowtype;
  v_new_sync_version integer;
begin
  if v_owner_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Lock existing row if present for atomic compare-and-swap
  select * into v_existing
  from public.dear_dumbass_encrypted_records
  where owner_id = v_owner_id and record_id = p_record_id
  for update;

  if not found then
    -- Inserting new record: expected_sync_version must be 0 or null
    if p_expected_sync_version is not null and p_expected_sync_version != 0 then
      return jsonb_build_object(
        'status', 'conflict',
        'current_sync_version', 0,
        'message', 'Record does not exist in cloud'
      );
    end if;

    insert into public.dear_dumbass_encrypted_records (
      owner_id,
      record_id,
      key_version,
      sync_version,
      ciphertext,
      iv,
      encryption_format_version
    ) values (
      v_owner_id,
      p_record_id,
      p_key_version,
      1,
      p_ciphertext,
      p_iv,
      p_encryption_format_version
    )
    returning * into v_existing;

    return jsonb_build_object(
      'status', 'ok',
      'sync_version', v_existing.sync_version,
      'server_change_sequence', v_existing.server_change_sequence
    );
  else
    -- Updating existing record: CAS check
    if p_expected_sync_version is null or v_existing.sync_version != p_expected_sync_version then
      return jsonb_build_object(
        'status', 'conflict',
        'current_sync_version', v_existing.sync_version,
        'server_change_sequence', v_existing.server_change_sequence,
        'message', 'Sync version conflict'
      );
    end if;

    v_new_sync_version := v_existing.sync_version + 1;

    update public.dear_dumbass_encrypted_records
    set
      key_version = p_key_version,
      sync_version = v_new_sync_version,
      ciphertext = p_ciphertext,
      iv = p_iv,
      encryption_format_version = p_encryption_format_version,
      server_change_sequence = nextval('public.dear_dumbass_records_change_seq'),
      updated_at = now()
    where owner_id = v_owner_id and record_id = p_record_id
    returning * into v_existing;

    return jsonb_build_object(
      'status', 'ok',
      'sync_version', v_existing.sync_version,
      'server_change_sequence', v_existing.server_change_sequence
    );
  end if;
end;
$$;

grant execute on function public.upsert_dear_dumbass_record(text, integer, integer, text, text, integer) to authenticated;
