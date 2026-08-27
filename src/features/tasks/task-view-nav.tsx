import Link from "next/link";

import { taskViews, type TaskView } from "@/types/task";

import styles from "./task-view-nav.module.css";

/**
 * Views are query parameters rather than routes, so the Tasks tab stays a
 * single destination in the shell's primary navigation.
 */
export function TaskViewNav({ current }: { current: TaskView }) {
  return (
    <nav className={styles.nav} aria-label="Task views">
      <ul className={styles.list}>
        {taskViews.map((view) => {
          const active = view.id === current;

          return (
            <li key={view.id}>
              <Link
                className={styles.chip}
                href={`/tasks?view=${view.id}`}
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
              >
                {view.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
