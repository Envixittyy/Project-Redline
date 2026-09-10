import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  NotebookPen,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import buttonStyles from "@/components/ui/button.module.css";
import { Surface } from "@/components/ui/surface";
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

export type HomeDashboardProps = {
  courses: CourseWithMeetings[];
  overdue: Task[];
  schedule: CalendarItem[];
  timeZone: string;
  today: Task[];
  upcoming: Task[];
  greeting?: HomeGreeting;
  telemetry?: SystemTelemetry | null;
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
  const upcomingWithoutToday = upcoming.filter(
    (task) => !today.some((item) => item.id === task.id),
  );

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date());

  const loadBadgeTone =
    telemetry?.loadLevel === "nominal"
      ? "success"
      : telemetry?.loadLevel === "moderate"
        ? "info"
        : telemetry?.loadLevel === "elevated"
          ? "warning"
          : "destructive";

  return (
    <div>
      {/* 1. Restrained S7 Greeting & Control Strip */}
      <header className={styles.homeHeader}>
        <div className={styles.greetingBlock}>
          <p className={styles.greetingEyebrow}>
            {greeting?.eyebrow ?? "YOUR SPACE"} · {formattedDate}
          </p>
          <h1 className={styles.greetingHeading}>
            {greeting?.greeting ?? "Welcome back, Kyle."}
            {greeting?.subtext ? (
              <span className={styles.greetingSubtext}>{greeting.subtext}</span>
            ) : null}
          </h1>
          {telemetry ? (
            <div className={styles.telemetryRow}>
              <Badge tone={loadBadgeTone} size="sm" dot>
                {`SYSTEM LOAD: ${telemetry.loadLevel.toUpperCase()}`}
              </Badge>
              <span className={styles.telemetryText}>
                {telemetry.telemetryText}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {/* 2. Customizable Daily Control Surface */}
      <DashboardCustomizer>
        {/* Anchor: What Matters Now */}
        <WhatShouldIDoNow
          tasks={today}
          scheduleItems={schedule}
          timeZone={timeZone}
        >
          <PossibleAssessmentsCard />
        </WhatShouldIDoNow>

        {/* Two-Column Asymmetric Flow */}
        <div className={styles.mainLayout}>
          {/* Column 1 (Left ~62%): The Daily Agenda & Tasks */}
          <div className={styles.primaryColumn}>
            {/* Today's Schedule Timeline */}
            <Surface
              variant="base"
              className={`${styles.sectionCard} motion-enter`}
              data-dashboard-widget="schedule"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGroup}>
                  <span className={styles.sectionIconWrap} aria-hidden="true">
                    <CalendarDays size={16} />
                  </span>
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
            </Surface>

            {/* Optional Today's Classes Breakdown */}
            <div data-dashboard-widget="today_classes">
              <TodayClassesCard courses={courses} timeZone={timeZone} />
            </div>

            {/* Tasks Section: Overdue Triage + Today's Focus */}
            <Surface
              variant="base"
              className={`${styles.sectionCard} motion-enter`}
              data-dashboard-widget="today"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGroup}>
                  <span className={styles.sectionIconWrap} aria-hidden="true">
                    <CalendarClock size={16} />
                  </span>
                  <div>
                    <p className={styles.sectionKicker}>Action Items</p>
                    <h3 className={styles.sectionTitle}>
                      {today.length
                        ? `${today.length} task${today.length === 1 ? "" : "s"} for today`
                        : "Clear tasks"}
                    </h3>
                  </div>
                </div>
                <Link href="/tasks?view=today" className={styles.sectionAction}>
                  Open Tasks →
                </Link>
              </div>

              {/* Overdue Attention Alert */}
              {overdue.length > 0 ? (
                <div
                  className={styles.overdueBanner}
                  data-dashboard-widget="overdue"
                >
                  <div className={styles.overdueHeaderRow}>
                    <div className={styles.overdueTitleGroup}>
                      <AlertCircle size={15} aria-hidden="true" />
                      <span>Overdue Tasks</span>
                    </div>
                    <Badge tone="destructive" size="sm">
                      {overdue.length} need attention
                    </Badge>
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
              ) : null}

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
              <div
                className={styles.upcomingFooter}
                data-dashboard-widget="upcoming"
              >
                <span>
                  {upcomingWithoutToday.length > 0
                    ? `${upcomingWithoutToday.length} upcoming in the next 7 days`
                    : "No tasks due in the next 7 days"}
                </span>
                <Link href="/tasks?view=next7">
                  View upcoming →
                </Link>
              </div>
            </Surface>
          </div>

          {/* Column 2 (Right ~38%): Academic Context & Quick Workspace */}
          <div className={styles.secondaryColumn}>
            {/* Next Class Card */}
            <div data-dashboard-widget="next_class">
              <NextClassCard courses={courses} timeZone={timeZone} />
            </div>

            {/* Enrolled Courses Reference */}
            <Surface
              variant="base"
              className={`${styles.sectionCard} motion-enter`}
              data-dashboard-widget="school"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGroup}>
                  <span className={styles.sectionIconWrap} aria-hidden="true">
                    <BookOpen size={16} />
                  </span>
                  <div>
                    <p className={styles.sectionKicker}>Academic</p>
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
            </Surface>

            {/* Quick Notes Tile */}
            <Surface
              variant="subtle"
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
            </Surface>
          </div>
        </div>
      </DashboardCustomizer>
    </div>
  );
}
