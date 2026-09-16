import Link from "next/link";
import { Suspense } from "react";
import {
  AlertCircle,
  ArrowRight,
  NotebookPen,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import buttonStyles from "@/components/ui/button.module.css";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import { WhatShouldIDoNow } from "@/features/planning/what-should-i-do-now";
import type { CourseWithMeetings } from "@/types/course";
import type { Task } from "@/types/task";

import { DashboardCustomizer } from "./dashboard-customizer";
import { HomeScheduleList } from "./home-schedule";
import { NextClassCard } from "./next-class-card";
import { TodayClassesCard } from "./today-classes-card";
import { PossibleAssessmentsCard } from "./possible-assessments-card";
import type { HomeGreeting, SystemTelemetry } from "./personality-greeting";
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

function TelemetryContent({ telemetry }: { telemetry: SystemTelemetry }) {
  const loadBadgeTone =
    telemetry.loadLevel === "nominal"
      ? "success"
      : telemetry.loadLevel === "moderate"
        ? "info"
        : telemetry.loadLevel === "elevated"
          ? "warning"
          : "destructive";

  return (
    <div className={styles.telemetryRow}>
      <Badge tone={loadBadgeTone} size="sm" dot>
        {`SYSTEM LOAD: ${telemetry.loadLevel.toUpperCase()}`}
      </Badge>
      <span className={styles.telemetryText}>
        {telemetry.telemetryText}
      </span>
    </div>
  );
}

async function DeferredTelemetry({
  telemetryPromise,
}: {
  telemetryPromise: Promise<SystemTelemetry | null>;
}) {
  const telemetry = await telemetryPromise;
  if (!telemetry) return null;
  return <TelemetryContent telemetry={telemetry} />;
}

function TelemetryFallback() {
  return (
    <div
      className={styles.telemetryRow}
      style={{ minHeight: "1.5rem" }}
      aria-hidden="true"
    />
  );
}

function OverdueContent({ overdue }: { overdue: Task[] }) {
  if (overdue.length === 0) return null;
  return (
    <div
      className={styles.overdueBanner}
      data-dashboard-widget="overdue"
    >
      <div className={styles.overdueHeaderRow}>
        <div className={styles.overdueTitleGroup}>
          <AlertCircle size={15} aria-hidden="true" />
          <span>Overdue Tasks</span>
        </div>
      </div>
      <ul className={styles.overdueList}>
        {overdue.slice(0, 3).map((task) => (
          <li key={task.id} className={styles.overdueItem}>
            <span className={styles.overdueItemTitle}>{task.title}</span>
            <span className={styles.overdueItemDate}>
              {taskTiming(task)}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/tasks?view=overdue"
        className={styles.overdueActionLink}
      >
        Review all {overdue.length} overdue tasks →
      </Link>
    </div>
  );
}

async function DeferredOverdue({
  overduePromise,
}: {
  overduePromise: Promise<Task[]>;
}) {
  const overdue = await overduePromise;
  return <OverdueContent overdue={overdue} />;
}

async function DeferredSectionTitle({
  overduePromise,
  todayCount,
}: {
  overduePromise: Promise<Task[]>;
  todayCount: number;
}) {
  const overdue = await overduePromise;
  if (overdue.length > 0) {
    return <>{`${overdue.length} need attention`}</>;
  }
  return (
    <>
      {todayCount > 0
        ? `${todayCount} task${todayCount === 1 ? "" : "s"} for today`
        : "Clear tasks"}
    </>
  );
}

function UpcomingContent({ count }: { count: number }) {
  return (
    <div
      className={styles.upcomingFooter}
      data-dashboard-widget="upcoming"
    >
      <span>
        {count > 0
          ? `${count} upcoming in the next 7 days`
          : "No tasks due in the next 7 days"}
      </span>
      <Link href="/tasks?view=next7">
        View upcoming →
      </Link>
    </div>
  );
}

async function DeferredUpcoming({
  upcomingPromise,
  todayIds,
}: {
  upcomingPromise: Promise<Task[]>;
  todayIds: Set<string>;
}) {
  const upcoming = await upcomingPromise;
  const upcomingWithoutToday = upcoming.filter((task) => !todayIds.has(task.id));
  return <UpcomingContent count={upcomingWithoutToday.length} />;
}

function UpcomingFallback() {
  return (
    <div
      className={styles.upcomingFooter}
      data-dashboard-widget="upcoming"
    >
      <span style={{ opacity: 0.65 }}>Checking upcoming tasks…</span>
      <Link href="/tasks?view=next7">
        View upcoming →
      </Link>
    </div>
  );
}

export type HomeDashboardProps = {
  courses: CourseWithMeetings[];
  overdue: Task[] | Promise<Task[]>;
  schedule: CalendarItem[];
  timeZone: string;
  today: Task[];
  upcoming: Task[] | Promise<Task[]>;
  greeting?: HomeGreeting;
  telemetry?: SystemTelemetry | null | Promise<SystemTelemetry | null>;
};

export function HomeDashboard({
  courses,
  overdue,
  schedule,
  timeZone,
  today,
  upcoming,
  greeting,
  telemetry,
}: HomeDashboardProps) {
  const todayIds = new Set(today.map((item) => item.id));
  const isUpcomingArray = Array.isArray(upcoming);
  const upcomingWithoutToday = isUpcomingArray
    ? upcoming.filter((task) => !todayIds.has(task.id))
    : [];

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date());

  const currentInstant = new Date();
  const formattedTime = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(currentInstant);

  return (
    <div className={styles.dailyCanvas}>
      {/* 1. Restrained S7 Greeting & Control Strip */}
      <header className={styles.homeHeader}>
        <div className={styles.greetingBlock}>
          <p className={styles.greetingEyebrow}>
            {greeting?.eyebrow ?? "YOUR SPACE"} · {formattedDate}
          </p>
          <h1 className={styles.greetingHeading}>
            {greeting?.greeting ?? "Welcome back, Kyle."}
            {greeting?.subtext ? (
              <>
                {" "}
                <span className={styles.greetingSubtext}>{greeting.subtext}</span>
              </>
            ) : null}
          </h1>
          {telemetry instanceof Promise ? (
            <Suspense fallback={<TelemetryFallback />}>
              <DeferredTelemetry telemetryPromise={telemetry} />
            </Suspense>
          ) : telemetry ? (
            <TelemetryContent telemetry={telemetry} />
          ) : null}
        </div>
        <div className={styles.clockBlock} aria-label={`Current time ${formattedTime}`}>
          <time className={styles.clock} dateTime={currentInstant.toISOString()}>
            {formattedTime}
          </time>
          <span className={styles.clockCaption}>Your day, in {timeZone}</span>
        </div>
      </header>

      {/* 2. Customizable Daily Control Surface */}
      <DashboardCustomizer>
        <div className={styles.focusBand}>
          <div className={styles.nextClassFocus} data-dashboard-widget="next_class">
            <NextClassCard courses={courses} timeZone={timeZone} />
          </div>
          <WhatShouldIDoNow
            tasks={today}
            scheduleItems={schedule}
            timeZone={timeZone}
          >
            <PossibleAssessmentsCard />
          </WhatShouldIDoNow>
        </div>

        {/* Two-Column Asymmetric Flow */}
        <div className={styles.mainLayout}>
          {/* Column 1 (Left ~62%): The Daily Agenda & Tasks */}
          <div className={styles.primaryColumn}>
            {/* Today's Schedule Timeline */}
            <section
              className={`${styles.sectionCard} motion-enter`}
              data-dashboard-widget="schedule"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGroup}>
                  <div>
                    <p className={styles.sectionKicker}>Today&apos;s Agenda</p>
                    <h3 className={styles.sectionTitle}>
                      {schedule.length
                        ? `${schedule.length} commitment${schedule.length === 1 ? "" : "s"}`
                        : "Clear schedule"}
                    </h3>
                  </div>
                </div>
                <Link href="/calendar" className={styles.sectionAction}>
                  Open Calendar →
                </Link>
              </div>
              <HomeScheduleList
                items={schedule}
                timeZone={timeZone}
                empty="Nothing scheduled for today. Your day is open."
              />
            </section>

            {/* Optional Today's Classes Breakdown */}
            <div data-dashboard-widget="today_classes">
              <TodayClassesCard courses={courses} timeZone={timeZone} />
            </div>

            {/* Tasks Section: Overdue Triage + Today's Focus */}
            <section
              className={`${styles.sectionCard} motion-enter`}
              data-dashboard-widget="today"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGroup}>
                  <div>
                    <p className={styles.sectionKicker}>Action Items</p>
                    <h3 className={styles.sectionTitle}>
                      {overdue instanceof Promise ? (
                        <Suspense
                          fallback={
                            today.length > 0
                              ? `${today.length} task${today.length === 1 ? "" : "s"} for today`
                              : "Clear tasks"
                          }
                        >
                          <DeferredSectionTitle
                            overduePromise={overdue}
                            todayCount={today.length}
                          />
                        </Suspense>
                      ) : overdue.length ? (
                        `${overdue.length} need attention`
                      ) : today.length ? (
                        `${today.length} task${today.length === 1 ? "" : "s"} for today`
                      ) : (
                        "Clear tasks"
                      )}
                    </h3>
                  </div>
                </div>
                <Link href="/tasks?view=today" className={styles.sectionAction}>
                  Open Tasks →
                </Link>
              </div>

              {/* Overdue Attention Alert */}
              {overdue instanceof Promise ? (
                <Suspense fallback={null}>
                  <DeferredOverdue overduePromise={overdue} />
                </Suspense>
              ) : (
                <OverdueContent overdue={overdue} />
              )}

              {/* Today's Tasks List */}
              {today.length > 0 ? (
                <ul className={styles.taskList}>
                  {today.slice(0, 5).map((task) => (
                    <li key={task.id} className={styles.taskItem}>
                      <span
                        className={styles.priorityMarker}
                        data-priority={task.priority}
                        aria-hidden="true"
                      />
                      <div className={styles.taskContent}>
                        <strong className={styles.taskTitle}>{task.title}</strong>
                        <small className={styles.taskMeta}>
                          {taskTiming(task)}
                          {task.course ? ` · ${task.course}` : ""}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  Nothing is due or scheduled today. Keep the space.
                </p>
              )}

              {/* Upcoming Tasks Preview Footnote */}
              {upcoming instanceof Promise ? (
                <Suspense fallback={<UpcomingFallback />}>
                  <DeferredUpcoming
                    upcomingPromise={upcoming}
                    todayIds={todayIds}
                  />
                </Suspense>
              ) : (
                <UpcomingContent count={upcomingWithoutToday.length} />
              )}
            </section>
          </div>

          {/* Column 2 (Right ~38%): Academic Context & Quick Workspace */}
          <div className={styles.secondaryColumn}>
            {/* Enrolled Courses Reference */}
            <section
              className={`${styles.sectionCard} motion-enter`}
              data-dashboard-widget="school"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGroup}>
                  <div>
                    <p className={styles.sectionKicker}>Courses</p>
                    <h3 className={styles.sectionTitle}>
                      {courses.length
                        ? `${courses.length} active course${courses.length === 1 ? "" : "s"}`
                        : "No courses set"}
                    </h3>
                  </div>
                </div>
                <Link href="/school" className={styles.sectionAction}>
                  School →
                </Link>
              </div>

              {courses.length > 0 ? (
                <ul className={styles.coursesList}>
                  {courses.slice(0, 4).map((course) => (
                    <li key={course.id} className={styles.courseItem}>
                      <span
                        className={styles.courseDot}
                        style={{ background: course.color ?? "var(--accent)" }}
                        aria-hidden="true"
                      />
                      <div className={styles.courseContent}>
                        <strong className={styles.courseCode}>
                          {course.code}
                        </strong>
                        <small className={styles.courseMeta}>
                          {course.name} · {course.meetings.length} weekly
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  Add courses and weekly meeting schedules in School.
                </p>
              )}
            </section>

            {/* Quick Notes Tile */}
            <section
              className={`${styles.notesCard} motion-enter`}
              data-dashboard-widget="notes"
            >
              <span className={styles.notesIconWrap} aria-hidden="true">
                <NotebookPen size={18} />
              </span>
              <div className={styles.notesContent}>
                <h4 className={styles.notesTitle}>Quick Note</h4>
                <p className={styles.notesDescription}>
                  Capture markdown thoughts or link them to courses.
                </p>
              </div>
              <div className={styles.notesAction}>
                <Link
                  href="/notes"
                  className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.sm}`}
                >
                  <span>Open Notes</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </DashboardCustomizer>
    </div>
  );
}
