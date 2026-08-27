-- Phase 1F: exact task deadlines and the Submitted workflow state.
--
-- `due_date` remains the stable local calendar day. `due_at` is optional and
-- adds an exact instant only when the user explicitly supplies a due time.
-- Personal scheduling continues to use scheduled_start/scheduled_end.

alter type task_status add value if not exists 'submitted' before 'completed';

alter table tasks
  add column due_at timestamptz,
  add constraint tasks_due_time_requires_date check (due_at is null or due_date is not null);

create index tasks_due_at_idx on tasks (due_at) where due_at is not null;
