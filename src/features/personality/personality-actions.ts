"use server";

import { buildCalendarItems } from "@/features/calendar/calendar-items";
import { addDays, resolveTimeZone, todayIn } from "@/lib/date/day";
import { listCourseMeetingsForCalendar } from "@/services/courses/course-repository";
import { readTaskWorkloadCounts } from "@/services/tasks/task-repository";

export async function readWorkloadAction() {
  try {
    const now = new Date(),
      timeZone = resolveTimeZone(),
      today = todayIn(timeZone, now);
    const [tasks, meetings] = await Promise.all([
      readTaskWorkloadCounts(now),
      listCourseMeetingsForCalendar(),
    ]);
    const classesToday = buildCalendarItems(
      [],
      [],
      [],
      timeZone,
      meetings,
      today,
      addDays(today, 1),
    ).filter(
      (item) => item.date === today && item.kind === "course_meeting",
    ).length;
    return {
      ok: true as const,
      workload: { ...tasks, classesToday },
      measuredAt: now.toISOString(),
    };
  } catch {
    return {
      ok: false as const,
      message: "Workload data unavailable. No assessment calculated.",
    };
  }
}
