-- Phase 1H-1K: persisted School, notes, private attachments, subtasks, and
-- idempotent offline mutation identities. Every personal row is owner-scoped
-- at the database boundary; normal application access uses the authenticated
-- request client and never the service role.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,
  name text not null,
  instructor text,
  location text,
  color text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_code_not_blank check (btrim(code) <> ''),
  constraint courses_name_not_blank check (btrim(name) <> ''),
  constraint courses_color_semantic check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  constraint courses_owner_code_unique unique (user_id, code)
);

create table public.course_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  weekdays smallint[] not null,
  start_date date not null,
  end_date_exclusive date,
  start_time time not null,
  end_time time not null,
  time_zone text not null default 'Asia/Manila',
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_meetings_title_not_blank check (btrim(title) <> ''),
  constraint course_meetings_weekdays_valid check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint course_meetings_date_range check (
    end_date_exclusive is null or end_date_exclusive > start_date
  ),
  constraint course_meetings_time_zone_not_blank check (btrim(time_zone) <> '')
);

alter table public.tasks
  add column parent_task_id uuid references public.tasks (id) on delete cascade,
  add column client_operation_id uuid,
  add constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),
  add constraint tasks_owner_operation_unique unique (user_id, client_operation_id);

create index tasks_owner_parent_idx on public.tasks (user_id, parent_task_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled note',
  body text not null default '',
  task_id uuid references public.tasks (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  archived_at timestamptz,
  client_operation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_title_not_blank check (btrim(title) <> ''),
  constraint notes_title_length check (char_length(title) <= 200),
  constraint notes_owner_operation_unique unique (user_id, client_operation_id)
);

create index notes_owner_updated_idx on public.notes (user_id, updated_at desc);
create index notes_owner_task_idx on public.notes (user_id, task_id) where task_id is not null;
create index notes_owner_course_idx on public.notes (user_id, course_id) where course_id is not null;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid references public.notes (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachments_parent_required check (num_nonnulls(note_id, task_id) = 1),
  constraint attachments_file_name_not_blank check (btrim(file_name) <> ''),
  constraint attachments_size_valid check (size_bytes between 1 and 10485760),
  constraint attachments_owner_path check (split_part(storage_path, '/', 1) = user_id::text),
  constraint attachments_storage_path_unique unique (storage_path)
);

create index courses_owner_active_idx on public.courses (user_id, archived_at, code);
create index course_meetings_owner_range_idx on public.course_meetings (user_id, start_date, end_date_exclusive);
create index attachments_owner_note_idx on public.attachments (user_id, note_id);
create index attachments_owner_task_idx on public.attachments (user_id, task_id);

-- Foreign keys prove existence, not ownership. Reject guessed cross-owner IDs
-- before they can form an integrity or cascade channel between users.
create function public.enforce_phase1_relationship_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'tasks' and new.parent_task_id is not null and not exists (
    select 1 from public.tasks parent where parent.id = new.parent_task_id and parent.user_id = new.user_id
  ) then
    raise exception 'parent task must belong to the same owner' using errcode = '23503';
  elsif tg_table_name = 'course_meetings' and not exists (
    select 1 from public.courses course where course.id = new.course_id and course.user_id = new.user_id
  ) then
    raise exception 'course must belong to the same owner' using errcode = '23503';
  elsif tg_table_name = 'notes' then
    if new.task_id is not null and not exists (
      select 1 from public.tasks task where task.id = new.task_id and task.user_id = new.user_id
    ) then raise exception 'task must belong to the same owner' using errcode = '23503'; end if;
    if new.course_id is not null and not exists (
      select 1 from public.courses course where course.id = new.course_id and course.user_id = new.user_id
    ) then raise exception 'course must belong to the same owner' using errcode = '23503'; end if;
  elsif tg_table_name = 'attachments' then
    if new.note_id is not null and not exists (
      select 1 from public.notes note where note.id = new.note_id and note.user_id = new.user_id
    ) then raise exception 'note must belong to the same owner' using errcode = '23503'; end if;
    if new.task_id is not null and not exists (
      select 1 from public.tasks task where task.id = new.task_id and task.user_id = new.user_id
    ) then raise exception 'task must belong to the same owner' using errcode = '23503'; end if;
  end if;
  return new;
end;
$$;

create trigger tasks_relationship_owner before insert or update on public.tasks
  for each row execute function public.enforce_phase1_relationship_owner();
create trigger course_meetings_relationship_owner before insert or update on public.course_meetings
  for each row execute function public.enforce_phase1_relationship_owner();
create trigger notes_relationship_owner before insert or update on public.notes
  for each row execute function public.enforce_phase1_relationship_owner();
create trigger attachments_relationship_owner before insert or update on public.attachments
  for each row execute function public.enforce_phase1_relationship_owner();

create trigger courses_set_updated_at before update on public.courses
  for each row execute function public.set_updated_at();
create trigger course_meetings_set_updated_at before update on public.course_meetings
  for each row execute function public.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();
create trigger attachments_set_updated_at before update on public.attachments
  for each row execute function public.set_updated_at();

alter table public.courses enable row level security;
alter table public.course_meetings enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['courses','course_meetings','notes','attachments'] loop
    execute format('create policy %I_select_own on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name, table_name);
    execute format('create policy %I_insert_own on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name, table_name);
    execute format('create policy %I_update_own on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name, table_name);
    execute format('create policy %I_delete_own on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name, table_name);
  end loop;
end $$;

-- The bucket is private. Object names begin with the verified owner UUID and
-- storage policies independently enforce that prefix.
insert into storage.buckets (id, name, public, file_size_limit)
values ('private-attachments', 'private-attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy attachments_storage_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'private-attachments' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy attachments_storage_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'private-attachments' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy attachments_storage_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'private-attachments' and split_part(name, '/', 1) = (select auth.uid())::text)
  with check (bucket_id = 'private-attachments' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy attachments_storage_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'private-attachments' and split_part(name, '/', 1) = (select auth.uid())::text);
