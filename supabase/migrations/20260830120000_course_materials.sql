-- Phase 7D: School Course Materials & Relational Task ↔ Material Links
-- Implements contracts from docs/FORWARD_ARCHITECTURE.md Section 12.4 and ROADMAP.md Phase 7D.
-- All tables, triggers, and RPCs are owner-scoped with Supabase RLS.

-- 1. Create course_materials table
create table if not exists public.course_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  type text not null default 'document' check (
    type in ('document', 'link', 'lecture', 'reading', 'assignment_reference', 'syllabus', 'other')
  ),
  url text check (url is null or btrim(url) <> ''),
  description text check (description is null or char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_materials_owner_course_idx
  on public.course_materials (user_id, course_id);

create trigger course_materials_set_updated_at
  before update on public.course_materials
  for each row execute function public.set_updated_at();

-- 2. Create task_course_material_links table (Many-to-Many relational link)
create table if not exists public.task_course_material_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  course_material_id uuid not null references public.course_materials(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists task_course_material_links_owner_unique
  on public.task_course_material_links (user_id, task_id, course_material_id);

create index if not exists task_course_material_links_owner_task_idx
  on public.task_course_material_links (user_id, task_id);

create index if not exists task_course_material_links_owner_material_idx
  on public.task_course_material_links (user_id, course_material_id);

-- 3. Owner relationship verification triggers
create or replace function public.enforce_course_material_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.courses c
    where c.id = new.course_id and c.user_id = new.user_id
  ) then
    raise exception 'course must belong to the course material owner' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger course_materials_owner_enforcement
  before insert or update on public.course_materials
  for each row execute function public.enforce_course_material_owner();

create or replace function public.enforce_task_course_material_link_owner() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_course_id uuid;
  material_course_id uuid;
begin
  select course_id into task_course_id
  from public.tasks
  where id = new.task_id and user_id = new.user_id;

  if not found then
    raise exception 'task must belong to the link owner' using errcode = '23503';
  end if;

  select course_id into material_course_id
  from public.course_materials
  where id = new.course_material_id and user_id = new.user_id;

  if not found then
    raise exception 'course material must belong to the link owner' using errcode = '23503';
  end if;

  if task_course_id is distinct from material_course_id then
    raise exception 'material course must match the task course' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger task_course_material_links_owner_enforcement
  before insert or update on public.task_course_material_links
  for each row execute function public.enforce_task_course_material_link_owner();

-- 4. Incompatible link cleanup trigger on task course change
create or replace function public.cleanup_incompatible_task_material_links() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.course_id is distinct from old.course_id then
    delete from public.task_course_material_links
    where task_id = new.id
      and user_id = new.user_id
      and course_material_id in (
        select id from public.course_materials
        where course_id is distinct from new.course_id
      );
  end if;
  return new;
end;
$$;

create trigger tasks_cleanup_incompatible_material_links
  after update on public.tasks
  for each row execute function public.cleanup_incompatible_task_material_links();

-- 5. Enable Row Level Security (RLS)
alter table public.course_materials enable row level security;
alter table public.task_course_material_links enable row level security;

create policy course_materials_select
  on public.course_materials
  for select
  to authenticated
  using (((select auth.uid()) = user_id));

create policy course_materials_insert
  on public.course_materials
  for insert
  to authenticated
  with check (((select auth.uid()) = user_id));

create policy course_materials_update
  on public.course_materials
  for update
  to authenticated
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy course_materials_delete
  on public.course_materials
  for delete
  to authenticated
  using (((select auth.uid()) = user_id));

create policy task_course_material_links_select
  on public.task_course_material_links
  for select
  to authenticated
  using (((select auth.uid()) = user_id));

create policy task_course_material_links_insert
  on public.task_course_material_links
  for insert
  to authenticated
  with check (((select auth.uid()) = user_id));

create policy task_course_material_links_delete
  on public.task_course_material_links
  for delete
  to authenticated
  using (((select auth.uid()) = user_id));

-- 6. Permissions
revoke all on public.course_materials from public;
revoke all on public.task_course_material_links from public;

grant select, insert, update, delete on public.course_materials to authenticated;
grant select, insert, delete on public.task_course_material_links to authenticated;

