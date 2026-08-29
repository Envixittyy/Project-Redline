-- P3 Google Calendar OAuth state. Raw state and PKCE verifiers are never
-- stored in plaintext; callback consumption deletes the one-time row.

alter table public.external_calendar_accounts
  add column refresh_lock_until timestamptz;

create table public.calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null,
  encrypted_pkce_verifier text not null,
  return_path text not null default '/integrations/calendars',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint calendar_oauth_states_hash check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint calendar_oauth_states_provider check (provider in ('google')),
  constraint calendar_oauth_states_return_path check (
    return_path like '/%' and return_path not like '//%'
  ),
  constraint calendar_oauth_states_expiry check (expires_at > created_at)
);

create index calendar_oauth_states_owner_expiry_idx
  on public.calendar_oauth_states (user_id, expires_at);

alter table public.calendar_oauth_states enable row level security;
create policy calendar_oauth_states_select_own on public.calendar_oauth_states
  for select to authenticated using ((select auth.uid()) = user_id);
create policy calendar_oauth_states_insert_own on public.calendar_oauth_states
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy calendar_oauth_states_delete_own on public.calendar_oauth_states
  for delete to authenticated using ((select auth.uid()) = user_id);
