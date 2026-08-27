-- Phase 1D: source-aware calendar events.
--
-- These rows are ordinary calendar events only. Scheduled tasks remain in the
-- tasks table and are combined with events solely in the Calendar read model.

create type calendar_event_source as enum ('life_os', 'blackboard', 'google_calendar');

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  event_type text not null default 'event',
  source calendar_event_source not null default 'life_os',
  external_id text,
  source_url text,

  -- Free text until the School phase establishes a course table. This can be
  -- promoted additively to a foreign key without changing event identity.
  course text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_events_title_not_blank check (btrim(title) <> ''),
  constraint calendar_events_title_length check (char_length(title) <= 200),
  constraint calendar_events_type_not_blank check (btrim(event_type) <> ''),
  constraint calendar_events_end_after_start check (ends_at > starts_at),
  constraint calendar_events_source_url_http check (
    source_url is null or source_url ~ '^https?://'
  ),
  constraint calendar_events_native_identity check (
    source <> 'life_os' or external_id is null
  )
);

create index calendar_events_range_idx on calendar_events (starts_at, ends_at);

create unique index calendar_events_external_identity_idx
  on calendar_events (source, external_id)
  where external_id is not null;

create trigger calendar_events_set_updated_at
  before update on calendar_events
  for each row
  execute function set_updated_at();

-- Match the private Phase 1C access model. Server-side service-role access is
-- the only access path until authentication adds owner columns and policies.
alter table calendar_events enable row level security;
