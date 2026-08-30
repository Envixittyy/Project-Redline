import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Course Materials Migration Security Contract (Phase 7D)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260830120000_course_materials.sql"),
    "utf8",
  );

  it("creates course_materials table with owner scoping and foreign keys", () => {
    expect(sql).toContain("create table if not exists public.course_materials");
    expect(sql).toContain("user_id uuid not null default auth.uid() references auth.users(id) on delete cascade");
    expect(sql).toContain("course_id uuid not null references public.courses(id) on delete cascade");
    expect(sql).toContain("title text not null check (btrim(title) <> '')");
    expect(sql).toContain("type in ('document', 'link', 'lecture', 'reading', 'assignment_reference', 'syllabus', 'other')");
  });

  it("creates task_course_material_links table with unique relational link constraint", () => {
    expect(sql).toContain("create table if not exists public.task_course_material_links");
    expect(sql).toContain("task_id uuid not null references public.tasks(id) on delete cascade");
    expect(sql).toContain("course_material_id uuid not null references public.course_materials(id) on delete cascade");
    expect(sql).toContain("create unique index if not exists task_course_material_links_owner_unique");
    expect(sql).toContain("(user_id, task_id, course_material_id)");
  });

  it("enforces owner verification trigger for course materials", () => {
    expect(sql).toContain("create or replace function public.enforce_course_material_owner()");
    expect(sql).toContain("create trigger course_materials_owner_enforcement");
    expect(sql).toContain("course must belong to the course material owner");
  });

  it("enforces cross-course and owner integrity trigger for task material links", () => {
    expect(sql).toContain("create or replace function public.enforce_task_course_material_link_owner()");
    expect(sql).toContain("create trigger task_course_material_links_owner_enforcement");
    expect(sql).toContain("task must belong to the link owner");
    expect(sql).toContain("course material must belong to the link owner");
    expect(sql).toContain("material course must match the task course");
  });

  it("enforces automatic cleanup trigger of incompatible material links on task course change", () => {
    expect(sql).toContain("create or replace function public.cleanup_incompatible_task_material_links()");
    expect(sql).toContain("create trigger tasks_cleanup_incompatible_material_links");
    expect(sql).toContain("delete from public.task_course_material_links");
  });

  it("enables RLS and defines owner-scoped authenticated policies", () => {
    expect(sql).toContain("alter table public.course_materials enable row level security;");
    expect(sql).toContain("alter table public.task_course_material_links enable row level security;");
    expect(sql).toContain("create policy course_materials_select");
    expect(sql).toContain("create policy course_materials_insert");
    expect(sql).toContain("create policy course_materials_update");
    expect(sql).toContain("create policy course_materials_delete");
    expect(sql).toContain("create policy task_course_material_links_select");
    expect(sql).toContain("create policy task_course_material_links_insert");
    expect(sql).toContain("create policy task_course_material_links_delete");
    expect(sql).toContain("((select auth.uid()) = user_id)");
  });
});

