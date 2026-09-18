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
  updated_at timestamptz not null default now(),
  constraint dear_dumbass_envelope_version_check check (envelope_version = 1),
  constraint dear_dumbass_key_version_check check (key_version = 1),
  constraint dear_dumbass_kdf_check check (
    kdf_algorithm = 'PBKDF2'
    and kdf_hash = 'SHA-256'
    and kdf_iterations = 600000
  ),
  constraint dear_dumbass_envelope_base64_check check (
    salt ~ '^[A-Za-z0-9+/]{22}==$'
    and wrap_iv ~ '^[A-Za-z0-9+/]{16}$'
    and encrypted_master_key ~ '^[A-Za-z0-9+/]{64}$'
  )
);

alter table public.dear_dumbass_key_envelopes enable row level security;

create policy dear_dumbass_key_envelopes_select_own
  on public.dear_dumbass_key_envelopes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy dear_dumbass_key_envelopes_insert_own
  on public.dear_dumbass_key_envelopes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_key_envelopes_update_own
  on public.dear_dumbass_key_envelopes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_key_envelopes_delete_own
  on public.dear_dumbass_key_envelopes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.dear_dumbass_key_envelopes from public, anon, authenticated;
grant select, insert on table public.dear_dumbass_key_envelopes to authenticated;

-- 2. Per-owner monotonic change sequence. The helper is not exposed through the
-- Data API schema and derives its owner from auth.uid(), so sequence values do
-- not reveal activity belonging to other users.
create schema if not exists dear_dumbass_private;
revoke all on schema dear_dumbass_private from public, anon, authenticated;

create table if not exists dear_dumbass_private.change_counters (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  next_sequence bigint not null default 1 check (next_sequence > 0)
);

alter table dear_dumbass_private.change_counters enable row level security;
revoke all on table dear_dumbass_private.change_counters from public, anon, authenticated;

create or replace function dear_dumbass_private.next_change_sequence()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_sequence bigint;
begin
  if v_owner_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into dear_dumbass_private.change_counters (owner_id, next_sequence)
  values (v_owner_id, 2)
  on conflict (owner_id) do update
    set next_sequence = dear_dumbass_private.change_counters.next_sequence + 1
  returning next_sequence - 1 into v_sequence;

  return v_sequence;
end;
$$;

revoke all on function dear_dumbass_private.next_change_sequence() from public, anon;
grant usage on schema dear_dumbass_private to authenticated;
grant execute on function dear_dumbass_private.next_change_sequence() to authenticated;

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
  server_change_sequence bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dear_dumbass_encrypted_records_owner_record_unique unique (owner_id, record_id),
  constraint dear_dumbass_encrypted_records_owner_sequence_unique unique (owner_id, server_change_sequence),
  constraint dear_dumbass_record_id_check check (
    char_length(record_id) between 1 and 128 and btrim(record_id) = record_id
  ),
  constraint dear_dumbass_record_key_version_check check (key_version = 1),
  constraint dear_dumbass_record_sync_version_check check (sync_version > 0),
  constraint dear_dumbass_record_format_check check (encryption_format_version = 1),
  constraint dear_dumbass_record_ciphertext_check check (
    char_length(ciphertext) between 24 and 6000000
    and ciphertext ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    and iv ~ '^[A-Za-z0-9+/]{16}$'
  )
);

create index if not exists dear_dumbass_records_cursor_idx
  on public.dear_dumbass_encrypted_records (owner_id, server_change_sequence);

alter table public.dear_dumbass_encrypted_records enable row level security;

create policy dear_dumbass_encrypted_records_select_own
  on public.dear_dumbass_encrypted_records
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy dear_dumbass_encrypted_records_insert_own
  on public.dear_dumbass_encrypted_records
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_encrypted_records_update_own
  on public.dear_dumbass_encrypted_records
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy dear_dumbass_encrypted_records_delete_own
  on public.dear_dumbass_encrypted_records
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.dear_dumbass_encrypted_records from public, anon, authenticated;
-- SECURITY INVOKER keeps RLS active, so the authenticated caller must retain
-- the exact table privileges used inside the RPC. DELETE remains unavailable.
grant select, insert, update on table public.dear_dumbass_encrypted_records to authenticated;

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
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_existing public.dear_dumbass_encrypted_records%rowtype;
  v_new_sync_version integer;
begin
  if v_owner_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_record_id is null or char_length(p_record_id) not between 1 and 128
    or btrim(p_record_id) <> p_record_id
    or p_key_version <> 1
    or p_encryption_format_version <> 1
    or p_ciphertext is null or char_length(p_ciphertext) not between 24 and 6000000
    or p_ciphertext !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    or p_iv is null or p_iv !~ '^[A-Za-z0-9+/]{16}$'
  then
    raise exception 'Invalid encrypted record parameters';
  end if;

  if p_expected_sync_version is not null and p_expected_sync_version < 0 then
    raise exception 'Invalid expected sync version';
  end if;

  if p_expected_sync_version is null or p_expected_sync_version = 0 then
    v_new_sync_version := dear_dumbass_private.next_change_sequence();
    insert into public.dear_dumbass_encrypted_records (
      owner_id,
      record_id,
      key_version,
      sync_version,
      ciphertext,
      iv,
      encryption_format_version,
      server_change_sequence
    ) values (
      v_owner_id,
      p_record_id,
      p_key_version,
      1,
      p_ciphertext,
      p_iv,
      p_encryption_format_version,
      v_new_sync_version
    )
    on conflict (owner_id, record_id) do nothing
    returning * into v_existing;

    if found then
      return jsonb_build_object(
        'status', 'ok',
        'sync_version', v_existing.sync_version,
        'server_change_sequence', v_existing.server_change_sequence
      );
    end if;
  end if;

  -- Lock the current row and compare against the caller's acknowledged version.
  select * into v_existing
  from public.dear_dumbass_encrypted_records
  where owner_id = v_owner_id and record_id = p_record_id
  for update;

  if not found then
      return jsonb_build_object(
        'status', 'conflict',
        'current_sync_version', 0,
        'message', 'Record does not exist in cloud'
      );
  end if;

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
      server_change_sequence = dear_dumbass_private.next_change_sequence(),
      updated_at = now()
    where owner_id = v_owner_id and record_id = p_record_id
    returning * into v_existing;

  return jsonb_build_object(
      'status', 'ok',
      'sync_version', v_existing.sync_version,
      'server_change_sequence', v_existing.server_change_sequence
  );
end;
$$;

revoke all on function public.upsert_dear_dumbass_record(text, integer, integer, text, text, integer) from public, anon;
grant execute on function public.upsert_dear_dumbass_record(text, integer, integer, text, text, integer) to authenticated;
