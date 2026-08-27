-- Phase 1C: the task domain.
--
-- Tasks and calendar events are separate entities. A task may carry a due date
-- and a scheduled interval, and a later phase may render it on the calendar,
-- but that rendering never creates a calendar-event row. There is deliberately
-- no events table here and no foreign key pointing at one.

create type task_status as enum ('inbox', 'todo', 'in_progress', 'completed', 'cancelled');
create type task_priority as enum ('none', 'low', 'medium', 'high', 'urgent');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status task_status not null default 'inbox',
  priority task_priority not null default 'none',

  -- A calendar day, not an instant: a deadline is timezone-independent.
  due_date date,

  -- Real instants: when the work is meant to happen.
  scheduled_start timestamptz,
  scheduled_end timestamptz,

  -- Free-text organisation for this phase. Areas, projects, and courses are not
  -- modelled as their own tables yet; see docs/ARCHITECTURE.md for the planned
  -- promotion to foreign keys.
  area text,
  project text,
  course text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint tasks_title_not_blank check (btrim(title) <> ''),
  constraint tasks_title_length check (char_length(title) <= 200),
  constraint tasks_end_requires_start check (scheduled_end is null or scheduled_start is not null),
  constraint tasks_end_after_start check (scheduled_end is null or scheduled_end >= scheduled_start),
  constraint tasks_completed_at_matches_status check (
    (status = 'completed') = (completed_at is not null)
  )
);

-- Every dated view (Today, Tomorrow, Next 7 Days, Overdue) filters open
-- statuses and then narrows by due date.
create index tasks_status_due_date_idx on tasks (status, due_date);

-- Completed view ordering.
create index tasks_completed_at_idx on tasks (completed_at desc) where completed_at is not null;

-- Scheduled lookups for the dated views now, and for the Phase 1D calendar
-- range query later.
create index tasks_scheduled_start_idx on tasks (scheduled_start) where scheduled_start is not null;

create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on tasks
  for each row
  execute function set_updated_at();

-- Private by design. Row level security is enabled with no policies, so the
-- anon and authenticated roles can read nothing even if a browser-exposed key
-- leaks. All access in this phase goes through the server-side service role,
-- which bypasses RLS. When authentication arrives, add a user_id column and
-- owner policies here rather than loosening this default.
alter table tasks enable row level security;
