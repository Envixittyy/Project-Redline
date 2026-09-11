import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock server-only modules
vi.mock("server-only", () => ({}));
vi.mock("@/features/tasks/task-actions", () => ({
  createTaskAction: vi.fn(async () => ({ ok: true })),
  setTaskCompletionAction: vi.fn(async () => ({ ok: true })),
  saveTaskAction: vi.fn(async () => ({ ok: true })),
  deleteTaskAction: vi.fn(async () => ({ ok: true })),
  createSubtaskAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/features/tasks/task-material-actions", () => ({
  getTaskMaterialsAction: vi.fn(async () => ({ ok: true, materials: [] })),
  getCourseMaterialsForPickerAction: vi.fn(async () => ({ ok: true, materials: [] })),
  linkTaskMaterialsAction: vi.fn(async () => ({ ok: true })),
  unlinkTaskMaterialAction: vi.fn(async () => ({ ok: true })),
}));

import type { Task } from "@/types/task";
import { TaskViewNav } from "./task-view-nav";
import { TaskRow } from "./task-row";
import { TaskCollection } from "./task-collection";
import { QuickAdd } from "./quick-add";

function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Finish problem set 4",
    description: "Chapter 5 problems 1 through 10",
    status: "todo",
    priority: "none",
    dueDate: "2026-09-11",
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    area: null,
    project: null,
    course: null,
    parentTaskId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("S7D3 Tasks Screen Overhaul", () => {
  describe("TaskViewNav", () => {
    it("renders primary segmented views with correct links and active state", () => {
      const markup = renderToStaticMarkup(<TaskViewNav current="today" />);

      expect(markup).toContain('href="/tasks?view=today"');
      expect(markup).toContain('href="/tasks?view=next7"');
      expect(markup).toContain('href="/tasks?view=overdue"');
      expect(markup).toContain('href="/tasks?view=inbox"');
      expect(markup).toContain('data-active="true"');
      expect(markup).toContain("Today");
      expect(markup).toContain("Upcoming");
      expect(markup).toContain("Overdue");
      expect(markup).toContain("Inbox");
    });

    it("renders secondary views menu trigger with active label when a secondary view is selected", () => {
      const markupToday = renderToStaticMarkup(<TaskViewNav current="today" />);
      expect(markupToday).toContain("More");

      const markupCompleted = renderToStaticMarkup(<TaskViewNav current="completed" />);
      expect(markupCompleted).toContain("Completed");
      expect(markupCompleted).toContain('data-active="true"');
    });

    it("displays overdue count badge when overdue tasks exist", () => {
      const markup = renderToStaticMarkup(<TaskViewNav current="today" overdueCount={3} />);

      expect(markup).toContain("3");
      expect(markup).toContain("overdueBadge");
    });
  });

  describe("TaskRow", () => {
    it("renders completion checkbox with accessible roles and labels", () => {
      const task = mockTask({ title: "Read lecture slides", status: "todo" });
      const markup = renderToStaticMarkup(
        <TaskRow
          task={task}
          today="2026-09-11"
          timeZone="UTC"
          busy={false}
          onToggleComplete={() => {}}
          onOpen={() => {}}
        />,
      );

      expect(markup).toContain('role="checkbox"');
      expect(markup).toContain('aria-checked="false"');
      expect(markup).toContain('aria-label="Complete Read lecture slides"');
      expect(markup).toContain("Read lecture slides");
    });

    it("renders completed state with strikethrough and checked status", () => {
      const task = mockTask({ title: "Submit assignment", status: "completed" });
      const markup = renderToStaticMarkup(
        <TaskRow
          task={task}
          today="2026-09-11"
          timeZone="UTC"
          busy={false}
          onToggleComplete={() => {}}
          onOpen={() => {}}
        />,
      );

      expect(markup).toContain('aria-checked="true"');
      expect(markup).toContain('aria-label="Reopen Submit assignment"');
      expect(markup).toContain('data-completed="true"');
    });

    it("renders restrained priority badge for urgent, high, and medium", () => {
      const urgentTask = mockTask({ priority: "urgent" });
      const highTask = mockTask({ priority: "high" });
      const medTask = mockTask({ priority: "medium" });
      const noneTask = mockTask({ priority: "none" });

      const urgentMarkup = renderToStaticMarkup(
        <TaskRow task={urgentTask} today="2026-09-11" timeZone="UTC" busy={false} onToggleComplete={() => {}} onOpen={() => {}} />,
      );
      const highMarkup = renderToStaticMarkup(
        <TaskRow task={highTask} today="2026-09-11" timeZone="UTC" busy={false} onToggleComplete={() => {}} onOpen={() => {}} />,
      );
      const medMarkup = renderToStaticMarkup(
        <TaskRow task={medTask} today="2026-09-11" timeZone="UTC" busy={false} onToggleComplete={() => {}} onOpen={() => {}} />,
      );
      const noneMarkup = renderToStaticMarkup(
        <TaskRow task={noneTask} today="2026-09-11" timeZone="UTC" busy={false} onToggleComplete={() => {}} onOpen={() => {}} />,
      );

      expect(urgentMarkup).toContain("Urgent");
      expect(highMarkup).toContain("High");
      expect(medMarkup).toContain("Med");
      expect(noneMarkup).not.toContain("None");
    });

    it("renders course identity and project tags with restraint", () => {
      const task = mockTask({
        course: "CS 350",
        project: "Compiler Frontend",
      });
      const markup = renderToStaticMarkup(
        <TaskRow task={task} today="2026-09-11" timeZone="UTC" busy={false} onToggleComplete={() => {}} onOpen={() => {}} />,
      );

      expect(markup).toContain("CS 350");
      expect(markup).toContain("Compiler Frontend");
    });
  });

  describe("TaskCollection", () => {
    it("renders Today view with Overdue and Due Today sections when both exist", () => {
      const todayTask = mockTask({ id: "t1", title: "Review pull request", dueDate: "2026-09-11" });
      const overdueTask = mockTask({ id: "t2", title: "Pay tuition invoice", dueDate: "2026-09-09" });

      const markup = renderToStaticMarkup(
        <TaskCollection
          tasks={[todayTask]}
          overdueTasks={[overdueTask]}
          view="today"
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("OVERDUE · 1");
      expect(markup).toContain("TODAY · 1");
      expect(markup).toContain("Pay tuition invoice");
      expect(markup).toContain("Review pull request");
    });

    it("renders Scheduled Today separately from general Due Today items", () => {
      const scheduledTask = mockTask({
        id: "s1",
        title: "Study session",
        scheduledStart: "2026-09-11T16:00:00.000Z",
        scheduledEnd: "2026-09-11T18:00:00.000Z",
      });
      const dueTask = mockTask({ id: "d1", title: "Submit problem set", dueDate: "2026-09-11" });

      const markup = renderToStaticMarkup(
        <TaskCollection
          tasks={[scheduledTask, dueTask]}
          overdueTasks={[]}
          view="today"
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("SCHEDULED TODAY · 1");
      expect(markup).toContain("DUE TODAY · 1");
      expect(markup).toContain("Study session");
      expect(markup).toContain("Submit problem set");
    });

    it("renders Upcoming view grouped by horizon", () => {
      const tomorrowTask = mockTask({ id: "u1", title: "Physics Quiz", dueDate: "2026-09-12" });
      const laterTask = mockTask({ id: "u2", title: "Essay outline", dueDate: "2026-09-15" });

      const markup = renderToStaticMarkup(
        <TaskCollection
          tasks={[tomorrowTask, laterTask]}
          view="next7"
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("TOMORROW · 1");
      expect(markup).toContain("Physics Quiz");
      expect(markup).toContain("Essay outline");
    });

    it("renders S7 EmptyState with encouraging copy when Today view has no tasks", () => {
      const markup = renderToStaticMarkup(
        <TaskCollection
          tasks={[]}
          overdueTasks={[]}
          view="today"
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("All clear for today");
      expect(markup).toContain("Nothing is scheduled or due today");
      expect(markup).toContain("Add a task");
    });

    it("renders S7 EmptyState for Overdue view when all deadlines are met", () => {
      const markup = renderToStaticMarkup(
        <TaskCollection
          tasks={[]}
          overdueTasks={[]}
          view="overdue"
          today="2026-09-11"
          timeZone="UTC"
        />,
      );

      expect(markup).toContain("No overdue tasks");
      expect(markup).toContain("You&#x27;re completely caught up on your deadlines");
    });
  });

  describe("QuickAdd", () => {
    it("renders compact composer with input, date control, and priority select", () => {
      const markup = renderToStaticMarkup(<QuickAdd defaultDueDate="2026-09-11" />);

      expect(markup).toContain('placeholder="Add a task… (Press Enter to save)"');
      expect(markup).toContain('value="2026-09-11"');
      expect(markup).toContain("Priority:");
      expect(markup).toContain('type="submit"');
    });
  });
});

