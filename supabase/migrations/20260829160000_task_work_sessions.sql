-- P3 Calendar platform: task-owned work sessions are distinct from deadlines,
-- native events, and external commitments. A task may own many sessions.

create table public.task_work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned',
  source text not null default 'manual',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_work_sessions_interval check (ends_at > starts_at),
  constraint task_work_sessions_status check (status in ('planned','completed','cancelled')),
  constraint task_work_sessions_source check (source in ('manual','planner')),
  constraint task_work_sessions_completion check (
    (status = 'completed') = (completed_at is not null)
  )
);

create index task_work_sessions_owner_range_idx
  on public.task_work_sessions (user_id, starts_at, ends_at)
  where status <> 'cancelled';
create index task_work_sessions_task_idx
  on public.task_work_sessions (user_id, task_id, starts_at);

create function public.enforce_task_work_session_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tasks task
    where task.id = new.task_id and task.user_id = new.user_id
  ) then
    raise exception 'work-session task must belong to the same owner' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger task_work_sessions_relationship_owner
  before insert or update on public.task_work_sessions
  for each row execute function public.enforce_task_work_session_owner();
create trigger task_work_sessions_set_updated_at
  before update on public.task_work_sessions
  for each row execute function public.set_updated_at();

alter table public.task_work_sessions enable row level security;
create policy task_work_sessions_select_own on public.task_work_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy task_work_sessions_insert_own on public.task_work_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy task_work_sessions_update_own on public.task_work_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy task_work_sessions_delete_own on public.task_work_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);
