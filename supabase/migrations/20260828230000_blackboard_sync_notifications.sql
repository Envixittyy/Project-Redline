-- Phase 2: encrypted integration accounts, external identity, observable sync,
-- announcements, and durable in-app/Web Push delivery state.

create table public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,
  status text not null default 'connected',
  encrypted_credential text not null,
  credential_hint text,
  course_mappings jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error_code text,
  sync_state text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_accounts_provider check (provider in ('blackboard','notion')),
  constraint integration_accounts_status check (status in ('connected','disconnected','attention')),
  constraint integration_accounts_sync_state check (sync_state in ('idle','syncing','failed')),
  constraint integration_accounts_owner_provider unique(user_id,provider)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.integration_accounts(id) on delete cascade,
  idempotency_key uuid not null, status text not null default 'running', started_at timestamptz not null default now(), completed_at timestamptz,
  seen_count integer not null default 0, created_count integer not null default 0, updated_count integer not null default 0, missing_count integer not null default 0,
  error_code text, constraint sync_runs_status check(status in('running','succeeded','failed','partial')), constraint sync_runs_owner_key unique(user_id,idempotency_key)
);

create table public.external_records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.integration_accounts(id) on delete cascade, provider text not null,
  external_uid text not null, task_id uuid references public.tasks(id) on delete set null, normalized_title text not null,
  course_code text, source_url text, source_created_at timestamptz, source_updated_at timestamptz, due_at timestamptz,
  content_hash text not null, last_seen_at timestamptz not null default now(), missing_since timestamptz, raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint external_records_provider check(provider in('blackboard','notion')),
  constraint external_records_account_uid unique(account_id,external_uid)
);

create table public.sync_changes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade, external_record_id uuid references public.external_records(id) on delete set null,
  change_type text not null, summary text not null, created_at timestamptz not null default now(),
  constraint sync_changes_type check(change_type in('created','updated','unchanged','missing','ambiguous','failed'))
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references public.integration_accounts(id) on delete cascade, external_id text not null, title text not null,
  excerpt text, body text, published_at timestamptz, course_id uuid references public.courses(id) on delete set null, author text, source_url text,
  unread boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint announcements_account_external unique(account_id,external_id)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, user_agent text, last_seen_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade, endpoint text not null, p256dh text not null, auth text not null,
  expires_at timestamptz, disabled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint push_subscriptions_owner_endpoint unique(user_id,endpoint)
);
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade, notification_type text not null, enabled boolean not null default true,
  quiet_start time, quiet_end time, time_zone text not null default 'Asia/Manila', daily_digest boolean not null default false,
  constraint notification_preferences_owner_scope unique nulls not distinct(user_id,course_id,notification_type)
);
create table public.notification_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_type text not null, dedupe_key text not null, title text not null, body text not null, deep_link text not null,
  course_id uuid references public.courses(id) on delete set null, read_at timestamptz, created_at timestamptz not null default now(),
  constraint notification_events_safe_link check(deep_link like '/%'), constraint notification_events_owner_dedupe unique(user_id,dedupe_key)
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notification_event_id uuid not null references public.notification_events(id) on delete cascade,
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null, channel text not null, status text not null default 'pending',
  attempted_at timestamptz, delivered_at timestamptz, error_code text, created_at timestamptz not null default now(),
  constraint notification_delivery_channel check(channel in('in_app','web_push')), constraint notification_delivery_status check(status in('pending','deferred','sent','failed','unavailable')),
  constraint notification_delivery_dedupe unique(notification_event_id,push_subscription_id,channel)
);

create index external_records_owner_missing_idx on public.external_records(user_id,missing_since) where missing_since is not null;
create index sync_runs_owner_started_idx on public.sync_runs(user_id,started_at desc);
create unique index sync_runs_one_active_per_account on public.sync_runs(account_id) where status='running';
create index notification_events_owner_unread_idx on public.notification_events(user_id,created_at desc) where read_at is null;

create trigger integration_accounts_updated before update on public.integration_accounts for each row execute function public.set_updated_at();
create trigger external_records_updated before update on public.external_records for each row execute function public.set_updated_at();
create trigger announcements_updated before update on public.announcements for each row execute function public.set_updated_at();
create trigger push_subscriptions_updated before update on public.push_subscriptions for each row execute function public.set_updated_at();

do $$ declare table_name text; begin
  foreach table_name in array array['integration_accounts','sync_runs','external_records','sync_changes','announcements','devices','push_subscriptions','notification_preferences','notification_events','notification_deliveries'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid())=user_id)',table_name,table_name);
    execute format('create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',table_name,table_name);
    execute format('create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',table_name,table_name);
    execute format('create policy %I_delete_own on public.%I for delete to authenticated using ((select auth.uid())=user_id)',table_name,table_name);
  end loop;
end $$;
