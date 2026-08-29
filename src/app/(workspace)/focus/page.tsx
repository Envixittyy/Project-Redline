import type { Metadata } from "next";

import { Surface } from "@/components/ui/surface";
import {
  buildCalendarItems,
  type CalendarItem,
} from "@/features/calendar/calendar-items";
import {
  buildFocusReadModel,
  type FocusReadModel,
} from "@/features/focus/focus-domain";
import { FocusView } from "@/features/focus/focus-view";
import { addDays, dayRangeIn, resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCalendarEventsInRange } from "@/services/calendar-events/calendar-event-repository";
import { listCourseMeetingsForCalendar } from "@/services/courses/course-repository";
import { listExternalCalendarEventsInRange } from "@/services/external-calendars/external-calendar-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import {
  listTasksByIds,
  listTasksForView,
} from "@/services/tasks/task-repository";
import { listWorkSessionsInRange } from "@/services/work-sessions/work-session-repository";

export const metadata: Metadata = {
  title: "Focus Mode",
  description: "Distraction-free focus presentation answering what actually matters right now.",
};

export default async function FocusPage() {
  const configured = isSupabaseConfigured();
  const timeZone = resolveTimeZone();
  const todayDate = todayIn(timeZone);
  const tomorrowDate = addDays(todayDate, 1);
  const range = dayRangeIn(todayDate, tomorrowDate, timeZone);

  let focusReadModel: FocusReadModel = {
    now: {
      kind: "empty_day",
      title: "Clear schedule",
      message: "No immediate commitments or tasks scheduled.",
    },
    next: null,
    todayItems: [],
    summary: {
      totalTodayCommitments: 0,
      totalTodayTasks: 0,
      completedTodayCount: 0,
      overdueCount: 0,
    },
  };

  if (configured) {
    const [
      todayTasks,
      overdueTasks,
      events,
      externalEvents,
      meetings,
      workSessions,
    ] = await Promise.all([
      listTasksForView("today"),
      listTasksForView("overdue"),
      listCalendarEventsInRange(range.start, range.end),
      listExternalCalendarEventsInRange(range.start, range.end),
      listCourseMeetingsForCalendar(),
      listWorkSessionsInRange(range.start, range.end),
    ]);

    const workSessionTasks =
      workSessions.length > 0
        ? await listTasksByIds(workSessions.map((session) => session.taskId))
        : [];
    const scheduledTasks = todayTasks.filter((task) => Boolean(task.scheduledStart));

    const scheduleItems: CalendarItem[] = buildCalendarItems(
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

    // Merge tasks avoiding duplicates
    const allTaskMap = new Map<string, typeof todayTasks[number]>();
    for (const t of overdueTasks) allTaskMap.set(t.id, t);
    for (const t of todayTasks) allTaskMap.set(t.id, t);
    for (const t of workSessionTasks) allTaskMap.set(t.id, t);

    focusReadModel = buildFocusReadModel({
      tasks: Array.from(allTaskMap.values()),
      scheduleItems,
      timeZone,
      date: todayDate,
    });
  }

  if (!configured) {
    return (
      <div style={{ maxWidth: "48rem", margin: "2rem auto", padding: "1rem" }}>
        <Surface variant="glass" style={{ padding: "1.5rem" }}>
          <h2>Connect Supabase to enter Focus Mode</h2>
          <p>
            Configure the public Supabase URL and publishable key to load your
            tasks and commitments in Focus Mode.
          </p>
        </Surface>
      </div>
    );
  }

  return <FocusView initialReadModel={focusReadModel} timeZone={timeZone} />;
}
