import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  NotebookPen,
} from "lucide-react";

import { Surface } from "@/components/ui/surface";
import type { CourseWithMeetings } from "@/types/course";
import type { Task } from "@/types/task";

import { DashboardCustomizer } from "./dashboard-customizer";
import styles from "./home-dashboard.module.css";

function taskTiming(task: Task) {
  if (task.dueAt) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(task.dueAt));
  }

  return task.dueDate ?? task.status.replaceAll("_", " ");
}

function TaskList({
  empty,
  tasks,
}: {
  empty: string;
  tasks: Task[];
}) {
  if (!tasks.length) return <p className={styles.empty}>{empty}</p>;

  return (
    <ul className={styles.list}>
      {tasks.slice(0, 5).map((task) => (
        <li key={task.id}>
          <span data-priority={task.priority} aria-hidden="true" />
          <div>
            <strong>{task.title}</strong>
            <small>{taskTiming(task)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

type HomeDashboardProps = {
  courses: CourseWithMeetings[];
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
};

export function HomeDashboard({
  courses,
  overdue,
  today,
  upcoming,
}: HomeDashboardProps) {
  const upcomingWithoutToday = upcoming.filter(
    (task) => !today.some((item) => item.id === task.id),
  );

  return (
    <DashboardCustomizer>
      <Surface
        variant="glass"
        className={`${styles.card} ${styles.today} motion-enter`}
        data-dashboard-widget="today"
      >
        <header>
          <span aria-hidden="true">
            <CalendarClock size={18} />
          </span>
          <div>
            <p>Today</p>
            <h3>
              {today.length
                ? `${today.length} item${today.length === 1 ? "" : "s"}`
                : "Clear schedule"}
            </h3>
          </div>
          <Link href="/tasks?view=today">Open</Link>
        </header>
        <TaskList
          tasks={today}
          empty="Nothing is due or scheduled today. Keep the space."
        />
      </Surface>

      <Surface
        variant="base"
        className={`${styles.card} motion-enter`}
        data-dashboard-widget="overdue"
      >
        <header>
          <span aria-hidden="true">
            <AlertCircle size={18} />
          </span>
          <div>
            <p>Overdue</p>
            <h3>
              {overdue.length
                ? `${overdue.length} need attention`
                : "All caught up"}
            </h3>
          </div>
          <Link href="/tasks?view=overdue">Review</Link>
        </header>
        <TaskList tasks={overdue} empty="No overdue work." />
      </Surface>

      <Surface
        variant="base"
        className={`${styles.card} motion-enter`}
        data-dashboard-widget="upcoming"
      >
        <header>
          <span aria-hidden="true">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <p>Upcoming</p>
            <h3>Next seven days</h3>
          </div>
          <Link href="/tasks?view=next7">View</Link>
        </header>
        <TaskList
          tasks={upcomingWithoutToday}
          empty="Nothing upcoming. You have room to breathe."
        />
      </Surface>

      <Surface
        variant="base"
        className={`${styles.card} motion-enter`}
        data-dashboard-widget="school"
      >
        <header>
          <span aria-hidden="true">
            <BookOpen size={18} />
          </span>
          <div>
            <p>School</p>
            <h3>
              {courses.length
                ? `${courses.length} active ${courses.length === 1 ? "course" : "courses"}`
                : "No courses yet"}
            </h3>
          </div>
          <Link href="/school">Open</Link>
        </header>
        {courses.length ? (
          <ul className={styles.courses}>
            {courses.slice(0, 4).map((course) => (
              <li key={course.id}>
                <span
                  style={{ background: course.color ?? "var(--accent)" }}
                  aria-hidden="true"
                />
                <div>
                  <strong>{course.code}</strong>
                  <small>
                    {course.meetings.length} weekly{" "}
                    {course.meetings.length === 1 ? "meeting" : "meetings"}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            Add courses and their weekly timetable in School.
          </p>
        )}
      </Surface>

      <Surface
        variant="subtle"
        className={`${styles.card} ${styles.note} motion-enter`}
        data-dashboard-widget="notes"
      >
        <NotebookPen size={22} aria-hidden="true" />
        <div>
          <h3>Capture a quick note</h3>
          <p>Write in Markdown and link the note to a task or course.</p>
        </div>
        <Link href="/notes">New note</Link>
      </Surface>
    </DashboardCustomizer>
  );
}
