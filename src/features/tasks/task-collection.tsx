"use client";

import { ListChecks } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import type { Task, TaskView } from "@/types/task";

import { setTaskCompletionAction } from "./task-actions";
import { TaskEditor } from "./task-editor";
import { TaskRow } from "./task-row";
import styles from "./task-collection.module.css";

const emptyCopy: Record<TaskView, string> = {
  inbox: "The inbox is clear. Tasks added without a date wait here.",
  today: "Nothing is due or scheduled today.",
  tomorrow: "Tomorrow is clear so far.",
  next7: "Nothing lands in the next seven days.",
  overdue: "Nothing is overdue.",
  someday: "No undated tasks are waiting.",
  submitted: "No tasks are waiting in Submitted.",
  completed: "No tasks have been completed yet.",
};

type TaskCollectionProps = {
  tasks: Task[];
  view: TaskView;
  today: string;
  timeZone: string;
};

export function TaskCollection({ tasks, view, today, timeZone }: TaskCollectionProps) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  function handleToggleComplete(task: Task, completed: boolean) {
    setError(null);
    setBusyId(task.id);

    startTransition(async () => {
      applyCompletion({ id: task.id, completed });

      const result = await setTaskCompletionAction(task.id, completed);
      setBusyId(null);

      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className={styles.collection}>
      {error ? (
        <Surface variant="subtle" className={styles.error} role="alert">
          {error}
        </Surface>
      ) : null}

      {optimisticTasks.length === 0 ? (
        <Surface variant="subtle" className={styles.empty}>
          <ListChecks size={22} aria-hidden="true" />
          <p>{emptyCopy[view]}</p>
        </Surface>
      ) : (
        <Surface variant="base" className={styles.list}>
          <ul className={styles.rows}>
            {optimisticTasks.map((task) => (
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
        </Surface>
      )}

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
