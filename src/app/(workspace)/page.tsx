import type { Metadata } from "next";

import { Surface } from "@/components/ui/surface";
import {
  buildCalendarItems,
  sortCalendarItemsChronologically,
  type CalendarItem,
} from "@/features/calendar/calendar-items";
import {
  getSystemLoadTelemetry,
  getTimeAwareGreeting,
} from "@/features/home/personality-greeting";
import { HomeDashboard } from "@/features/home/home-dashboard";
import { addDays, dayRangeIn, resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCalendarEventsInRange } from "@/services/calendar-events/calendar-event-repository";
import {
  listCourses,
  listCourseMeetingsForCalendar,
} from "@/services/courses/course-repository";
import { listExternalCalendarEventsInRange } from "@/services/external-calendars/external-calendar-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import {
  readTaskWorkloadCounts,
  listTasksByIds,
  listTasksForView,
} from "@/services/tasks/task-repository";
import { listWorkSessionsInRange } from "@/services/work-sessions/work-session-repository";

export const metadata: Metadata = {
  title: "So, Ano Na?",
};

export default async function HomePage() {
  const configured = isSupabaseConfigured();
  const timeZone = resolveTimeZone();
  const todayDate = todayIn(timeZone);
  const tomorrowDate = addDays(todayDate, 1);
  const range = dayRangeIn(todayDate, tomorrowDate, timeZone);

  let todayTasks: Awaited<ReturnType<typeof listTasksForView>> = [];
  let overdueTasks:
    | Awaited<ReturnType<typeof listTasksForView>>
    | Promise<Awaited<ReturnType<typeof listTasksForView>>> = [];
  let upcomingTasks:
    | Awaited<ReturnType<typeof listTasksForView>>
    | Promise<Awaited<ReturnType<typeof listTasksForView>>> = [];
  let courses: Awaited<ReturnType<typeof listCourses>> = [];
  let schedule: CalendarItem[] = [];
  let telemetryPromise: Promise<ReturnType<typeof getSystemLoadTelemetry> | null> | null = null;

  if (configured) {
    // Secondary data kicked off in parallel; deferred off critical path
    const overduePromise = listTasksForView("overdue").catch(() => []);
    const upcomingPromise = listTasksForView("next7").catch(() => []);
    const workloadPromise = readTaskWorkloadCounts().catch(() => null);

    const [
      todayResult,
      coursesResult,
      events,
      externalEvents,
      meetings,
      workSessions,
    ] = await Promise.all([
      listTasksForView("today"),
      listCourses(),
      listCalendarEventsInRange(range.start, range.end),
      listExternalCalendarEventsInRange(range.start, range.end),
      listCourseMeetingsForCalendar(),
      listWorkSessionsInRange(range.start, range.end),
    ]);

    todayTasks = todayResult;
    courses = coursesResult;
    overdueTasks = overduePromise;
    upcomingTasks = upcomingPromise;

    const workSessionTasks =
      workSessions.length > 0
        ? await listTasksByIds(workSessions.map((session) => session.taskId))
        : [];
    const scheduledTasks = todayTasks.filter((task) =>
      Boolean(task.scheduledStart),
    );

    const scheduleItems = buildCalendarItems(
      events,
      scheduledTasks,
      [],
      timeZone,
      meetings,
      todayDate,
      tomorrowDate,
      workSessions,
      workSessionTasks,
      externalEvents,
    ).filter((item) => item.date === todayDate);

    schedule = sortCalendarItemsChronologically(scheduleItems);

    const todayClassesCount = schedule.filter(
      (item) => item.kind === "course_meeting",
    ).length;

    telemetryPromise = workloadPromise.then((workload) =>
      workload
        ? getSystemLoadTelemetry({
            openTaskCount: workload.remainingTasks,
            dueSoonCount: workload.dueToday,
            overdueCount: workload.overdue,
            todayClassCount: todayClassesCount,
          })
        : null,
    );
  }

  const greeting = getTimeAwareGreeting("Kyle", new Date(), timeZone);

  return configured ? (
    <HomeDashboard
      courses={courses}
      greeting={greeting}
      overdue={overdueTasks}
      schedule={schedule}
      telemetry={telemetryPromise}
      timeZone={timeZone}
      today={todayTasks}
      upcoming={upcomingTasks}
    />
  ) : (
    <Surface variant="glass" style={{ padding: "2rem" }}>
      <h2>Connect Supabase to load Home</h2>
      <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
        Configure the public Supabase URL and publishable key, then apply the
        migrations. No demo data is inserted automatically.
      </p>
    </Surface>
  );
}
