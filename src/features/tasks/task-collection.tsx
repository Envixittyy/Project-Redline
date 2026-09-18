"use client";

import {
  AlertCircle,
  Archive,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Inbox,
  Layers,
  Plus,
} from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Surface } from "@/components/ui/surface";
import { copy } from "@/lib/copy";
import { addDays } from "@/lib/date/day";
import type { Task, TaskView } from "@/types/task";

import { setTaskCompletionAction } from "./task-actions";
import { TaskEditor } from "./task-editor";
import { formatDueDate } from "./task-formatting";
import { TaskRow } from "./task-row";
import styles from "./task-collection.module.css";

const viewMeta: Record<
  TaskView,
  {
    title: string;
    description: string;
    kicker: string;
    icon: typeof CheckCircle2;
  }
> = {
  today: {
    title: copy.emptyStates.tasks.today.title,
    description: copy.emptyStates.tasks.today.description,
    kicker: "TODAY",
    icon: CheckCircle2,
  },
  next7: {
    title: copy.emptyStates.tasks.next7.title,
    description: copy.emptyStates.tasks.next7.description,
    kicker: "UPCOMING",
    icon: CalendarDays,
  },
  overdue: {
    title: copy.emptyStates.tasks.overdue.title,
    description: copy.emptyStates.tasks.overdue.description,
    kicker: "OVERDUE",
    icon: CheckCircle2,
  },
  inbox: {
    title: copy.emptyStates.tasks.inbox.title,
    description: copy.emptyStates.tasks.inbox.description,
    kicker: "INBOX",
    icon: Inbox,
  },
  tomorrow: {
    title: copy.emptyStates.tasks.tomorrow.title,
    description: copy.emptyStates.tasks.tomorrow.description,
    kicker: "TOMORROW",
    icon: CalendarDays,
  },
  someday: {
    title: copy.emptyStates.tasks.someday.title,
    description: copy.emptyStates.tasks.someday.description,
    kicker: "SOMEDAY",
    icon: Layers,
  },
  submitted: {
    title: copy.emptyStates.tasks.submitted.title,
    description: copy.emptyStates.tasks.submitted.description,
    kicker: "SUBMITTED",
    icon: Archive,
  },
  completed: {
    title: copy.emptyStates.tasks.completed.title,
    description: copy.emptyStates.tasks.completed.description,
    kicker: "COMPLETED",
    icon: CheckCircle2,
  },
};

type TaskCollectionProps = {
  tasks: Task[];
  overdueTasks?: Task[];
  view: TaskView;
  today: string;
  timeZone: string;
};

export function TaskCollection({
  tasks,
  overdueTasks = [],
  view,
  today,
  timeZone,
}: TaskCollectionProps) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [, startTransition] = useTransition();

  const [optimisticTasks, applyCompletion] = useOptimistic(
    tasks,
    (state: Task[], change: { id: string; completed: boolean }) =>
      state.map((task) =>
        task.id === change.id
          ? { ...task, status: change.completed ? ("completed" as const) : ("todo" as const) }
          : task,
      ),
  );

  const [optimisticOverdue, applyOverdueCompletion] = useOptimistic(
    overdueTasks,
    (state: Task[], change: { id: string; completed: boolean }) =>
      state.map((task) =>
        task.id === change.id
          ? { ...task, status: change.completed ? ("completed" as const) : ("todo" as const) }
          : task,
      ),
  );

  function handleToggleComplete(task: Task, completed: boolean) {
    setError(null);
    setBusyId(task.id);

    startTransition(async () => {
      const isOverdue = optimisticOverdue.some((t) => t.id === task.id);
      if (isOverdue) {
        applyOverdueCompletion({ id: task.id, completed });
      } else {
        applyCompletion({ id: task.id, completed });
      }

      const result = await setTaskCompletionAction(task.id, completed);
      setBusyId(null);

      if (!result.ok) setError(result.message);
    });
  }

  function handleFocusQuickAdd() {
    const input = document.querySelector<HTMLInputElement>("#tasks-quick-add input[name='title']");
    input?.focus();
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Client search filtering
  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = (t: Task) =>
    query === "" ||
    t.title.toLowerCase().includes(query) ||
    Boolean(t.course?.toLowerCase().includes(query)) ||
    Boolean(t.project?.toLowerCase().includes(query)) ||
    Boolean(t.area?.toLowerCase().includes(query));

  const filteredTasks = optimisticTasks.filter(matchesQuery);
  const filteredOverdue = optimisticOverdue.filter(matchesQuery);

  const isSearching = query.length > 0;
  const totalMatches = filteredTasks.length + (view === "today" ? filteredOverdue.length : 0);

  // Grouping for Today view
  const scheduledToday = filteredTasks.filter((t) => t.scheduledStart !== null);
  const dueToday = filteredTasks.filter((t) => t.scheduledStart === null);

  // Grouping for Upcoming (next7) view
  const tomorrowDate = addDays(today, 1);
  const upcomingGroups = (() => {
    if (view !== "next7") return [];
    const groups: Map<string, Task[]> = new Map();

    for (const task of filteredTasks) {
      let label = "Later this week";
      if (task.dueDate) {
        if (task.dueDate === tomorrowDate) {
          label = "Tomorrow";
        } else {
          label = formatDueDate(task.dueDate, today);
        }
      }
      const existing = groups.get(label) ?? [];
      existing.push(task);
      groups.set(label, existing);
    }
    return Array.from(groups.entries());
  })();

  const meta = viewMeta[view];
  const EmptyIcon = meta.icon;

  return (
    <div className={styles.container}>
      {/* Search Toolbar (only shown if there are tasks to filter or an active search) */}
      {(optimisticTasks.length > 2 || optimisticOverdue.length > 0 || isSearching) ? (
        <div className={styles.toolbar}>
          <SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder={`Filter ${meta.kicker.toLowerCase()} tasks…`}
            className={styles.searchInput}
          />
          {isSearching ? (
            <span className={styles.matchCount}>
              {totalMatches} {totalMatches === 1 ? "match" : "matches"}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Surface variant="subtle" className={styles.error} role="alert">
          {error}
        </Surface>
      ) : null}

      {/* Case 1: Active search yielded zero matches */}
      {isSearching && totalMatches === 0 ? (
        <Surface variant="subtle" className={styles.emptyContainer}>
          <EmptyState
            title="No matching tasks"
            description={`No tasks match "${searchQuery}" in ${meta.kicker.toLowerCase()}.`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearchQuery("")}>
                Clear filter
              </Button>
            }
          />
        </Surface>
      ) : null}

      {/* Case 2: Standard Views */}
      {!isSearching && optimisticTasks.length === 0 && (view !== "today" || optimisticOverdue.length === 0) ? (
        <Surface variant="subtle" className={styles.emptyContainer}>
          <EmptyState
            icon={<EmptyIcon size={28} className={styles.emptyIcon} />}
            title={meta.title}
            description={meta.description}
            action={
              view === "today" || view === "inbox" || view === "tomorrow" ? (
                <Button variant="secondary" size="sm" onClick={handleFocusQuickAdd}>
                  <Plus size={14} aria-hidden="true" />
                  <span>Add a task</span>
                </Button>
              ) : null
            }
          />
        </Surface>
      ) : null}

      {/* View: TODAY (Execution surface with Overdue + Scheduled + Due) */}
      {view === "today" && (filteredOverdue.length > 0 || filteredTasks.length > 0) ? (
        <div className={styles.sectionStack}>
          {/* Overdue triage group */}
          {filteredOverdue.length > 0 ? (
            <section className={styles.group} aria-label="Overdue tasks">
              <div className={styles.groupHeader}>
                <span className={styles.overdueKicker}>
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>OVERDUE · {filteredOverdue.length}</span>
                </span>
              </div>
              <div className={styles.listSurface}>
                <ul className={styles.rows}>
                  {filteredOverdue.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      timeZone={timeZone}
                      busy={busyId === task.id}
                      onToggleComplete={handleToggleComplete}
                      onOpen={setEditing}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {/* Scheduled for today */}
          {scheduledToday.length > 0 ? (
            <section className={styles.group} aria-label="Tasks scheduled today">
              <div className={styles.groupHeader}>
                <span className={styles.groupKicker}>
                  <CalendarClock size={13} aria-hidden="true" />
                  <span>SCHEDULED TODAY · {scheduledToday.length}</span>
                </span>
              </div>
              <div className={styles.listSurface}>
                <ul className={styles.rows}>
                  {scheduledToday.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      timeZone={timeZone}
                      busy={busyId === task.id}
                      onToggleComplete={handleToggleComplete}
                      onOpen={setEditing}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {/* Due today */}
          {dueToday.length > 0 ? (
            <section className={styles.group} aria-label="Tasks due today">
              <div className={styles.groupHeader}>
                <span className={styles.groupKicker}>
                  <CalendarDays size={13} aria-hidden="true" />
                  <span>
                    {scheduledToday.length > 0 ? "DUE TODAY" : "TODAY"} · {dueToday.length}
                  </span>
                </span>
              </div>
              <div className={styles.listSurface}>
                <ul className={styles.rows}>
                  {dueToday.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      timeZone={timeZone}
                      busy={busyId === task.id}
                      onToggleComplete={handleToggleComplete}
                      onOpen={setEditing}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {/* Overdue existed but today has 0 items */}
          {filteredOverdue.length > 0 && filteredTasks.length === 0 && !isSearching ? (
            <p className={styles.todayClearNote}>
              <CheckCircle2 size={15} aria-hidden="true" />
              <span>Nothing else is due or scheduled today.</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* View: UPCOMING (next7) grouped by day horizons */}
      {view === "next7" && upcomingGroups.length > 0 ? (
        <div className={styles.sectionStack}>
          {upcomingGroups.map(([label, groupTasks]) => (
            <section key={label} className={styles.group} aria-label={`Tasks for ${label}`}>
              <div className={styles.groupHeader}>
                <span className={styles.groupKicker}>
                  <CalendarDays size={13} aria-hidden="true" />
                  <span>{label.toUpperCase()} · {groupTasks.length}</span>
                </span>
              </div>
              <div className={styles.listSurface}>
                <ul className={styles.rows}>
                  {groupTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      timeZone={timeZone}
                      busy={busyId === task.id}
                      onToggleComplete={handleToggleComplete}
                      onOpen={setEditing}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {/* Other Views: OVERDUE, INBOX, TOMORROW, SOMEDAY, COMPLETED, SUBMITTED */}
      {view !== "today" && view !== "next7" && filteredTasks.length > 0 ? (
        <section className={styles.group} aria-label={`${meta.kicker} tasks`}>
          <div className={styles.groupHeader}>
            <span className={view === "overdue" ? styles.overdueKicker : styles.groupKicker}>
              {view === "overdue" ? (
                <AlertCircle size={13} aria-hidden="true" />
              ) : (
                <meta.icon size={13} aria-hidden="true" />
              )}
              <span>{meta.kicker} · {filteredTasks.length}</span>
            </span>
          </div>
          <div className={styles.listSurface}>
            <ul className={styles.rows}>
              {filteredTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  timeZone={timeZone}
                  busy={busyId === task.id}
                  onToggleComplete={handleToggleComplete}
                  onOpen={setEditing}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {editing ? (
        <TaskEditor
          key={editing.id}
          task={editing}
          timeZone={timeZone}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
