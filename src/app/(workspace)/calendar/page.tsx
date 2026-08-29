import { CalendarDays, DatabaseZap } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { calendarRange, formatCalendarHeading, isCalendarView, normalizeCalendarDate } from "@/features/calendar/calendar-date";
import { buildCalendarItems } from "@/features/calendar/calendar-items";
import { CalendarWorkspace } from "@/features/calendar/calendar-workspace";
import { dayRangeIn, resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCalendarEventsInRange } from "@/services/calendar-events/calendar-event-repository";
import { listCourseMeetingsForCalendar } from "@/services/courses/course-repository";
import { listExternalCalendarEventsInRange } from "@/services/external-calendars/external-calendar-repository";
import { isSupabaseConfigured } from "@/services/supabase/public-config";
import { listTaskLinkOptions, listTasksByIds, listTasksForCalendarRange } from "@/services/tasks/task-repository";
import { listWorkSessionsInRange } from "@/services/work-sessions/work-session-repository";

import styles from "./calendar-page.module.css";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const requestedDate = Array.isArray(params.date) ? params.date[0] : params.date;

  const timeZone = resolveTimeZone();
  const today = todayIn(timeZone);
  const view = isCalendarView(requestedView) ? requestedView : "month";
  const anchor = normalizeCalendarDate(requestedDate, today);
  const { fromDate, toDateExclusive } = calendarRange(view, anchor);
  const range = dayRangeIn(fromDate, toDateExclusive, timeZone);

  let content: React.ReactNode;

  if (!isSupabaseConfigured()) {
    content = (
      <Surface variant="glass" className={styles.notice}>
        <span className={styles.noticeIcon} aria-hidden="true"><DatabaseZap size={22} /></span>
        <h2>Connect Supabase to use Calendar</h2>
        <p>
          Configure Supabase and apply the committed migrations in <code>supabase/migrations</code>.
          Calendar events and task scheduling stay in separate tables.
        </p>
      </Surface>
    );
  } else {
    let calendarData:
      | { items: ReturnType<typeof buildCalendarItems>; taskOptions: Array<{ id: string; title: string }>; failure: null }
      | { items: null; taskOptions: []; failure: string };

    try {
      const [events, externalEvents, taskRange, meetings, workSessions, taskOptions] = await Promise.all([
        listCalendarEventsInRange(range.start, range.end),
        listExternalCalendarEventsInRange(range.start, range.end),
        listTasksForCalendarRange(range.start, range.end, fromDate, toDateExclusive),
        listCourseMeetingsForCalendar(),
        listWorkSessionsInRange(range.start, range.end),
        listTaskLinkOptions(),
      ]);
      const workSessionTasks = await listTasksByIds(workSessions.map((session) => session.taskId));
      const items = buildCalendarItems(
        events,
        taskRange.scheduled,
        taskRange.deadlines,
        timeZone,
        meetings,
        fromDate,
        toDateExclusive,
        workSessions,
        workSessionTasks,
        externalEvents,
      )
        .filter((item) => item.date >= fromDate && item.date < toDateExclusive);

      calendarData = { items, taskOptions, failure: null };
    } catch (error) {
      calendarData = {
        items: null,
        taskOptions: [],
        failure: error instanceof Error ? error.message : "Something went wrong reading calendar data.",
      };
    }

    content = calendarData.items ? (
        <CalendarWorkspace
          view={view}
          anchor={anchor}
          heading={formatCalendarHeading(view, anchor)}
          fromDate={fromDate}
          toDateExclusive={toDateExclusive}
          today={today}
          timeZone={timeZone}
          items={calendarData.items}
          taskOptions={calendarData.taskOptions}
        />
      ) : (
        <Surface variant="subtle" className={styles.notice} role="alert">
          <span className={styles.noticeIcon} aria-hidden="true"><CalendarDays size={22} /></span>
          <h2>Calendar could not be loaded</h2>
          <p>{calendarData.failure}</p>
          <p>If tasks already work, apply the latest Calendar migrations to Supabase.</p>
        </Surface>
      );
  }

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Events, planned task work, and due-only deadlines in one view—without merging their underlying domains."
      />
      {content}
    </>
  );
}
