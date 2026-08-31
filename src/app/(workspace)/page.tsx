import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
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
  title: "Home",
};

export default async function HomePage() {
  const configured = isSupabaseConfigured();
  const timeZone = resolveTimeZone();
  const todayDate = todayIn(timeZone);
  const tomorrowDate = addDays(todayDate, 1);
  const range = dayRangeIn(todayDate, tomorrowDate, timeZone);

  let todayTasks: Awaited<ReturnType<typeof listTasksForView>> = [];
  let overdueTasks: Awaited<ReturnType<typeof listTasksForView>> = [];
  let upcomingTasks: Awaited<ReturnType<typeof listTasksForView>> = [];
  let courses: Awaited<ReturnType<typeof listCourses>> = [];
  let schedule: CalendarItem[] = [];
  let workload: Awaited<ReturnType<typeof readTaskWorkloadCounts>> | null =
    null;

  if (configured) {
    const [
      todayResult,
      overdueResult,
      upcomingResult,
      coursesResult,
      events,
      externalEvents,
      meetings,
      workSessions,
      workloadResult,
    ] = await Promise.all([
      listTasksForView("today"),
      listTasksForView("overdue"),
      listTasksForView("next7"),
      listCourses(),
      listCalendarEventsInRange(range.start, range.end),
      listExternalCalendarEventsInRange(range.start, range.end),
      listCourseMeetingsForCalendar(),
      listWorkSessionsInRange(range.start, range.end),
      readTaskWorkloadCounts().catch(() => null),
    ]);

    todayTasks = todayResult;
    overdueTasks = overdueResult;
    upcomingTasks = upcomingResult;
    courses = coursesResult;
    workload = workloadResult;

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
  }

  const greeting = getTimeAwareGreeting("Kyle", new Date(), timeZone);
  const todayClassesCount = schedule.filter(
    (item) => item.kind === "course_meeting",
  ).length;
  const telemetry = workload
    ? getSystemLoadTelemetry({
        openTaskCount: workload.remainingTasks,
        dueSoonCount: workload.dueToday,
        overdueCount: workload.overdue,
        todayClassCount: todayClassesCount,
      }).telemetryText
    : "Workload unavailable";

  return (
    <>
      <PageHeader
        eyebrow={greeting.eyebrow}
        title={`${greeting.greeting} ${greeting.subtext}`}
        description={`${telemetry} — Classes, deadlines, notes, unfinished business, and whatever else has made its way into the system.`}
      />
      {configured ? (
        <HomeDashboard
          courses={courses}
          overdue={overdueTasks}
          schedule={schedule}
          timeZone={timeZone}
          today={todayTasks}
          upcoming={upcomingTasks}
        />
      ) : (
        <Surface variant="glass" style={{ padding: "1rem" }}>
          <h2>Connect Supabase to load Home</h2>
          <p>
            Configure the public Supabase URL and publishable key, then apply
            the migrations. No demo data is inserted automatically.
          </p>
        </Surface>
      )}
    </>
  );
}
