-- Keep table-specific NEW fields inside table-specific PL/pgSQL branches.
-- A shared boolean expression can attempt to resolve fields that do not exist
-- on the trigger's current row type before its table-name guard short-circuits.

create or replace function public.enforce_phase1_relationship_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'tasks' then
    if new.parent_task_id is not null and not exists (
      select 1
      from public.tasks parent
      where parent.id = new.parent_task_id
        and parent.user_id = new.user_id
    ) then
      raise exception 'parent task must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'course_meetings' then
    if not exists (
      select 1
      from public.courses course
      where course.id = new.course_id
        and course.user_id = new.user_id
    ) then
      raise exception 'course must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'notes' then
    if new.task_id is not null and not exists (
      select 1
      from public.tasks task
      where task.id = new.task_id
        and task.user_id = new.user_id
    ) then
      raise exception 'task must belong to the same owner' using errcode = '23503';
    end if;

    if new.course_id is not null and not exists (
      select 1
      from public.courses course
      where course.id = new.course_id
        and course.user_id = new.user_id
    ) then
      raise exception 'course must belong to the same owner' using errcode = '23503';
    end if;
  elsif tg_table_name = 'attachments' then
    if new.note_id is not null and not exists (
      select 1
      from public.notes note
      where note.id = new.note_id
        and note.user_id = new.user_id
    ) then
      raise exception 'note must belong to the same owner' using errcode = '23503';
    end if;

    if new.task_id is not null and not exists (
      select 1
      from public.tasks task
      where task.id = new.task_id
        and task.user_id = new.user_id
    ) then
      raise exception 'task must belong to the same owner' using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;
