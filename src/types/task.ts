export const taskStatuses = [
  { id: "inbox", label: "Inbox" },
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
] as const;

export type TaskStatus = (typeof taskStatuses)[number]["id"];

export const taskPriorities = [
  { id: "none", label: "None" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
] as const;

export type TaskPriority = (typeof taskPriorities)[number]["id"];

/** Statuses that still represent outstanding work. */
export const openTaskStatuses = ["inbox", "todo", "in_progress"] as const;

export const taskViews = [
  { id: "inbox", label: "Inbox" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "next7", label: "Next 7 days" },
  { id: "overdue", label: "Overdue" },
  { id: "someday", label: "Someday" },
  { id: "completed", label: "Completed" },
] as const;

export type TaskView = (typeof taskViews)[number]["id"];

export const defaultTaskView: TaskView = "today";

/**
 * A task is its own entity. `dueDate` is a calendar day and `scheduledStart` /
 * `scheduledEnd` are instants describing when the work happens. Rendering a
 * scheduled task on the calendar is a presentation concern; it never turns the
 * task into a calendar event.
 */
export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  area: string | null;
  project: string | null;
  course: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TaskDraft = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  area?: string | null;
  project?: string | null;
  course?: string | null;
};

export type TaskPatch = Partial<TaskDraft>;

export function isTaskView(value: string | undefined): value is TaskView {
  return taskViews.some((view) => view.id === value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return taskStatuses.some((status) => status.id === value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return taskPriorities.some((priority) => priority.id === value);
}

export function taskStatusLabel(status: TaskStatus): string {
  return taskStatuses.find((entry) => entry.id === status)?.label ?? status;
}

export function taskPriorityLabel(priority: TaskPriority): string {
  return taskPriorities.find((entry) => entry.id === priority)?.label ?? priority;
}
