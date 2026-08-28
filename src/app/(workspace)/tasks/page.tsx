import type { Metadata } from "next";
import { Suspense } from "react";
import { DatabaseZap } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { QuickAdd } from "@/features/tasks/quick-add";
import { TaskCollection } from "@/features/tasks/task-collection";
import { TaskViewNav } from "@/features/tasks/task-view-nav";
import { addDays, resolveTimeZone, todayIn } from "@/lib/date/day";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import { listTasksForView } from "@/services/tasks/task-repository";
import { defaultTaskView, isTaskView, type Task, type TaskView } from "@/types/task";

import styles from "./tasks-page.module.css";

export const metadata: Metadata = { title: "Tasks" };

function TaskSkeleton() {
  return (
    <Surface variant="base" className={styles.skeleton} aria-busy="true" aria-label="Loading tasks">
      <span />
      <span />
      <span />
    </Surface>
  );
}

async function TaskResults({
  view,
  today,
  timeZone,
}: {
  view: TaskView;
  today: string;
  timeZone: string;
}) {
  let tasks: Task[] | null = null;
  let failure: string | null = null;

  try {
    tasks = await listTasksForView(view);
  } catch (error) {
    // The repository has already logged the underlying cause.
    failure = error instanceof Error ? error.message : "Something went wrong reading your tasks.";
  }

  if (!tasks) {
    return (
      <Surface variant="subtle" className={styles.notice} role="alert">
        <h2>Tasks could not be loaded</h2>
        <p>{failure}</p>
      </Surface>
    );
  }

  return <TaskCollection tasks={tasks} view={view} today={today} timeZone={timeZone} />;
}

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const requested = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = isTaskView(requested) ? requested : defaultTaskView;

  const timeZone = resolveTimeZone();
  const today = todayIn(timeZone);

  const prefillDueDate =
    view === "today" ? today : view === "tomorrow" ? addDays(today, 1) : undefined;

  return (
    <>
      <PageHeader
        title="Tasks"
        description="A focused home for what needs doing. A task can carry a deadline and a scheduled time without becoming a calendar event."
      />

      {isSupabaseConfigured() ? (
        <div className={styles.layout}>
          <QuickAdd defaultDueDate={prefillDueDate} />
          <TaskViewNav current={view} />
          {/* Keyed so switching views re-shows the skeleton instead of stale rows. */}
          <Suspense key={view} fallback={<TaskSkeleton />}>
            <TaskResults view={view} today={today} timeZone={timeZone} />
          </Suspense>
        </div>
      ) : (
        <Surface variant="glass" className={styles.notice}>
          <span className={styles.noticeIcon} aria-hidden="true">
            <DatabaseZap size={22} />
          </span>
          <h2>Connect Supabase to start capturing tasks</h2>
          <p>
            Copy <code>.env.example</code> to <code>.env.local</code>, set the public Supabase URL
            and publishable key, then apply <code>supabase/migrations</code> to your project.
          </p>
        </Surface>
      )}
    </>
  );
}
