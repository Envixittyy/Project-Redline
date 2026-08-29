import type { CalendarItem } from "@/features/calendar/calendar-items";
import {
  isIsoDate,
  isIsoInstant,
  todayIn,
} from "@/lib/date/day";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

import {
  isOpenTask,
  priorityToNumeric,
  estimateTaskDuration,
} from "@/features/planning/planning-domain";
import { isTaskOverdue } from "@/features/calendar/calendar-domain";

export type FocusNow =
  | {
      kind: "active_work_session";
      title: string;
      task: Task;
      workSession: WorkSession;
      startsAt: string;
      endsAt: string;
      remainingMinutes: number;
      totalDurationMinutes: number;
    }
  | {
      kind: "active_commitment";
      title: string;
      source: "course_meeting" | "calendar_event" | "external_event";
      startsAt: string;
      endsAt: string;
      remainingMinutes: number;
      meta?: string;
      color?: string | null;
    }
  | {
      kind: "imminent_commitment";
      title: string;
      source: "course_meeting" | "calendar_event" | "external_event";
      startsAt: string;
      minutesUntilStart: number;
      meta?: string;
      color?: string | null;
    }
  | {
      kind: "next_action_task";
      title: string;
      task: Task;
      estimatedMinutes: number;
      reason: string;
    }
  | {
      kind: "all_caught_up";
      title: string;
      message: string;
    }
  | {
      kind: "empty_day";
      title: string;
      message: string;
    };

export type FocusNext =
  | {
      kind: "next_work_session";
      title: string;
      task: Task;
      workSession: WorkSession;
      startsAt: string;
      minutesUntilStart: number;
      durationMinutes: number;
    }
  | {
      kind: "next_commitment";
      title: string;
      source: "course_meeting" | "calendar_event" | "external_event";
      startsAt: string;
      minutesUntilStart: number;
      meta?: string;
      color?: string | null;
    }
  | {
      kind: "next_task";
      title: string;
      task: Task;
      estimatedMinutes: number;
    }
  | null;

export type FocusTodayItem = {
  id: string;
  key: string;
  title: string;
  kind:
    | "hard_deadline"
    | "overdue_deadline"
    | "work_session"
    | "course_meeting"
    | "calendar_event"
    | "external_event"
    | "scheduled_task"
    | "today_task";
  timing: string;
  startsAt?: string;
  endsAt?: string;
  dueAt?: string;
  dueDate?: string;
  task?: Task;
  meta?: string;
  color?: string | null;
  isOverdue?: boolean;
};

export type FocusReadModel = {
  now: FocusNow;
  next: FocusNext;
  todayItems: readonly FocusTodayItem[];
  summary: {
    totalTodayCommitments: number;
    totalTodayTasks: number;
    completedTodayCount: number;
    overdueCount: number;
  };
};

export type BuildFocusInput = {
  tasks: readonly Task[];
  scheduleItems?: readonly CalendarItem[];
  timeZone: string;
  nowIso?: string;
  date?: string;
};

function formatClockTime(isoString: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function extractItemTitle(item: CalendarItem): string {
  if (item.kind === "event") return item.event.title;
  if (item.kind === "external_event") return item.externalEvent.title;
  if (item.kind === "course_meeting") return item.meeting.title;
  return item.task.title;
}

function extractItemMeta(item: CalendarItem): string | undefined {
  if (item.kind === "course_meeting") {
    return item.entry.courseLabel ?? item.meeting.course.label ?? "Course";
  }
  if (item.kind === "external_event") {
    const provider =
      item.externalEvent.provider === "microsoft"
        ? "Outlook"
        : item.externalEvent.provider === "google"
          ? "Google Calendar"
          : item.externalEvent.provider;
    return item.externalEvent.calendarName
      ? `${item.externalEvent.calendarName} (${provider})`
      : provider;
  }
  if (item.kind === "event") {
    return item.event.course ?? "Calendar event";
  }
  if (item.kind === "work_session") {
    return item.task.course ? `${item.task.course} · Work session` : "Work session";
  }
  if (item.kind === "scheduled_task") {
    return item.task.course ? `${item.task.course} · Scheduled task` : "Scheduled task";
  }
  return undefined;
}

function extractItemColor(item: CalendarItem): string | null {
  if (item.kind === "course_meeting") {
    return item.entry.courseColor ?? null;
  }
  return null;
}

/**
 * Deterministically orders open tasks for next action.
 * Priority: Overdue with timed deadline > Overdue dated > Highest priority > Earliest deadline today > Title.
 */
export function orderTasksForFocus(
  tasks: readonly Task[],
  nowMs: number,
  timeZone: string,
): Task[] {
  const open = tasks.filter(isOpenTask);

  return [...open].sort((a, b) => {
    const aOverdue = isTaskOverdue(a, new Date(nowMs), timeZone);
    const bOverdue = isTaskOverdue(b, new Date(nowMs), timeZone);

    if (aOverdue !== bOverdue) {
      return aOverdue ? -1 : 1;
    }

    const priorityDiff = priorityToNumeric(b.priority) - priorityToNumeric(a.priority);
    if (priorityDiff !== 0) return priorityDiff;

    // Compare deadlines
    const aDue = a.dueAt ? Date.parse(a.dueAt) : a.dueDate ? Date.parse(`${a.dueDate}T23:59:59`) : Infinity;
    const bDue = b.dueAt ? Date.parse(b.dueAt) : b.dueDate ? Date.parse(`${b.dueDate}T23:59:59`) : Infinity;

    if (aDue !== bDue) return aDue - bDue;

    return a.title.localeCompare(b.title);
  });
}

/**
 * Pure, deterministic Focus / Goldfish filter and read-model generator.
 * Isolates the immediate working set into NOW, NEXT, and TODAY without mutating input data.
 */
export function buildFocusReadModel(input: BuildFocusInput): FocusReadModel {
  const {
    tasks,
    scheduleItems = [],
    timeZone,
    nowIso = new Date().toISOString(),
    date = todayIn(timeZone, new Date(nowIso)),
  } = input;

  const nowMs = Date.parse(nowIso);

  // 1. Identify relevant items for today & overdue
  const openTasks = tasks.filter(isOpenTask);
  const completedTasks = tasks.filter((t) => t.status === "completed");

  const overdueTasks = openTasks.filter((t) => isTaskOverdue(t, new Date(nowMs), timeZone));

  const todayDatedTasks = openTasks.filter(
    (t) =>
      !overdueTasks.includes(t) &&
      ((t.dueDate && t.dueDate === date) ||
        (t.dueAt && todayIn(timeZone, new Date(t.dueAt)) === date) ||
        (t.scheduledStart && todayIn(timeZone, new Date(t.scheduledStart)) === date)),
  );

  // Filter schedule items strictly for today
  const todayScheduleItems = scheduleItems.filter((item) => item.date === date);

  // Active work session right now
  const activeWorkSessionItem = todayScheduleItems.find((item) => {
    if (item.kind !== "work_session") return false;
    if (!item.entry.start || !item.entry.end) return false;
    const startMs = Date.parse(item.entry.start);
    const endMs = Date.parse(item.entry.end);
    return nowMs >= startMs && nowMs < endMs && isOpenTask(item.task);
  });

  // Active commitment right now (event, external event, course meeting)
  const activeCommitmentItem = todayScheduleItems.find((item) => {
    if (
      item.kind !== "event" &&
      item.kind !== "external_event" &&
      item.kind !== "course_meeting"
    ) {
      return false;
    }
    if (item.entry.allDay) {
      // Whole-day events are active all day
      return true;
    }
    if (!item.entry.start || !item.entry.end) return false;
    const startMs = Date.parse(item.entry.start);
    const endMs = Date.parse(item.entry.end);
    return nowMs >= startMs && nowMs < endMs;
  });

  // Imminent commitment starting within 15 minutes
  const imminentCommitmentItem = todayScheduleItems.find((item) => {
    if (
      item.kind !== "event" &&
      item.kind !== "external_event" &&
      item.kind !== "course_meeting"
    ) {
      return false;
    }
    if (item.entry.allDay || !item.entry.start) return false;
    const startMs = Date.parse(item.entry.start);
    return startMs > nowMs && startMs - nowMs <= 15 * 60_000;
  });

  // Ordered candidate tasks for next action
  const candidateTasks = orderTasksForFocus(
    [...overdueTasks, ...todayDatedTasks],
    nowMs,
    timeZone,
  );

  // Compute NOW
  let now: FocusNow;

  if (activeWorkSessionItem && activeWorkSessionItem.kind === "work_session") {
    const endMs = Date.parse(activeWorkSessionItem.entry.end!);
    const startMs = Date.parse(activeWorkSessionItem.entry.start!);
    const remainingMinutes = Math.max(1, Math.round((endMs - nowMs) / 60_000));
    const totalDurationMinutes = Math.max(1, Math.round((endMs - startMs) / 60_000));

    now = {
      kind: "active_work_session",
      title: activeWorkSessionItem.task.title,
      task: activeWorkSessionItem.task,
      workSession: activeWorkSessionItem.workSession,
      startsAt: activeWorkSessionItem.entry.start!,
      endsAt: activeWorkSessionItem.entry.end!,
      remainingMinutes,
      totalDurationMinutes,
    };
  } else if (activeCommitmentItem) {
    const endMs = activeCommitmentItem.entry.end ? Date.parse(activeCommitmentItem.entry.end) : nowMs + 60_000;
    const remainingMinutes = Math.max(1, Math.round((endMs - nowMs) / 60_000));
    const source =
      activeCommitmentItem.kind === "course_meeting"
        ? "course_meeting"
        : activeCommitmentItem.kind === "external_event"
          ? "external_event"
          : "calendar_event";

    now = {
      kind: "active_commitment",
      title: extractItemTitle(activeCommitmentItem),
      source,
      startsAt: activeCommitmentItem.entry.start ?? nowIso,
      endsAt: activeCommitmentItem.entry.end ?? nowIso,
      remainingMinutes,
      meta: extractItemMeta(activeCommitmentItem),
      color: extractItemColor(activeCommitmentItem),
    };
  } else if (imminentCommitmentItem && imminentCommitmentItem.entry.start) {
    const startMs = Date.parse(imminentCommitmentItem.entry.start);
    const minutesUntilStart = Math.max(1, Math.round((startMs - nowMs) / 60_000));
    const source =
      imminentCommitmentItem.kind === "course_meeting"
        ? "course_meeting"
        : imminentCommitmentItem.kind === "external_event"
          ? "external_event"
          : "calendar_event";

    now = {
      kind: "imminent_commitment",
      title: extractItemTitle(imminentCommitmentItem),
      source,
      startsAt: imminentCommitmentItem.entry.start,
      minutesUntilStart,
      meta: extractItemMeta(imminentCommitmentItem),
      color: extractItemColor(imminentCommitmentItem),
    };
  } else if (candidateTasks.length > 0) {
    const topTask = candidateTasks[0];
    const isOverdue = isTaskOverdue(topTask, new Date(nowMs), timeZone);
    const est = estimateTaskDuration(topTask);

    now = {
      kind: "next_action_task",
      title: topTask.title,
      task: topTask,
      estimatedMinutes: est,
      reason: isOverdue
        ? "Needs attention today"
        : topTask.priority === "urgent" || topTask.priority === "high"
          ? "High priority for today"
          : "Scheduled for today",
    };
  } else if (completedTasks.length > 0 && openTasks.length === 0 && todayScheduleItems.length === 0) {
    now = {
      kind: "all_caught_up",
      title: "All caught up",
      message: "You've completed all tasks and commitments for today.",
    };
  } else {
    now = {
      kind: "empty_day",
      title: "Clear schedule",
      message: "No immediate commitments or tasks scheduled for right now.",
    };
  }

  // Compute NEXT
  let next: FocusNext = null;

  // Look for upcoming timed items today
  const upcomingTimedItems = todayScheduleItems
    .filter((item) => {
      if (item.entry.allDay || !item.entry.start) return false;
      return Date.parse(item.entry.start) > nowMs;
    })
    .sort((a, b) => Date.parse(a.entry.start!) - Date.parse(b.entry.start!));

  const firstUpcomingItem = upcomingTimedItems[0];

  if (firstUpcomingItem) {
    const startMs = Date.parse(firstUpcomingItem.entry.start!);
    const minutesUntilStart = Math.max(1, Math.round((startMs - nowMs) / 60_000));

    if (firstUpcomingItem.kind === "work_session") {
      const durationMinutes = firstUpcomingItem.entry.end
        ? Math.max(1, Math.round((Date.parse(firstUpcomingItem.entry.end) - startMs) / 60_000))
        : 30;

      next = {
        kind: "next_work_session",
        title: firstUpcomingItem.task.title,
        task: firstUpcomingItem.task,
        workSession: firstUpcomingItem.workSession,
        startsAt: firstUpcomingItem.entry.start!,
        minutesUntilStart,
        durationMinutes,
      };
    } else if (
      firstUpcomingItem.kind === "course_meeting" ||
      firstUpcomingItem.kind === "event" ||
      firstUpcomingItem.kind === "external_event"
    ) {
      const source =
        firstUpcomingItem.kind === "course_meeting"
          ? "course_meeting"
          : firstUpcomingItem.kind === "external_event"
            ? "external_event"
            : "calendar_event";

      next = {
        kind: "next_commitment",
        title: extractItemTitle(firstUpcomingItem),
        source,
        startsAt: firstUpcomingItem.entry.start!,
        minutesUntilStart,
        meta: extractItemMeta(firstUpcomingItem),
        color: extractItemColor(firstUpcomingItem),
      };
    }
  } else {
    // If no upcoming timed commitment, find the next candidate task not currently in NOW
    const currentTaskId =
      now.kind === "active_work_session" || now.kind === "next_action_task"
        ? now.task.id
        : null;

    const remainingTasks = candidateTasks.filter((t) => t.id !== currentTaskId);
    if (remainingTasks.length > 0) {
      const secondTask = remainingTasks[0];
      next = {
        kind: "next_task",
        title: secondTask.title,
        task: secondTask,
        estimatedMinutes: estimateTaskDuration(secondTask),
      };
    }
  }

  // Compute TODAY items (filtered, deduplicated, zero-guilt)
  const todayItems: FocusTodayItem[] = [];
  const seenKeys = new Set<string>();

  // 1. Overdue tasks (presented calmly as needs attention)
  for (const task of overdueTasks) {
    const key = `task:${task.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let timing = "Needs attention";
    if (task.dueAt && isIsoInstant(task.dueAt)) {
      timing = `Due ${formatClockTime(task.dueAt, timeZone)}`;
    } else if (task.dueDate && isIsoDate(task.dueDate)) {
      timing = "Past deadline";
    }

    todayItems.push({
      id: task.id,
      key,
      title: task.title,
      kind: "overdue_deadline",
      timing,
      dueAt: task.dueAt ?? undefined,
      dueDate: task.dueDate ?? undefined,
      task,
      meta: task.course ?? undefined,
      isOverdue: true,
    });
  }

  // 2. Timed schedule items for today (meetings, events, work sessions)
  for (const item of todayScheduleItems) {
    if (seenKeys.has(item.key)) continue;
    seenKeys.add(item.key);

    let timing = "Today";
    if (item.entry.allDay) {
      timing = "All day";
    } else if (item.entry.start) {
      const startClock = formatClockTime(item.entry.start, timeZone);
      if (item.entry.end) {
        timing = `${startClock} – ${formatClockTime(item.entry.end, timeZone)}`;
      } else {
        timing = startClock;
      }
    }

    let kind: FocusTodayItem["kind"] = "calendar_event";
    let task: Task | undefined;

    if (item.kind === "course_meeting") {
      kind = "course_meeting";
    } else if (item.kind === "external_event") {
      kind = "external_event";
    } else if (item.kind === "work_session") {
      kind = "work_session";
      task = item.task;
    } else if (item.kind === "scheduled_task") {
      kind = "scheduled_task";
      task = item.task;
    } else if (item.kind === "deadline") {
      kind = "hard_deadline";
      task = item.task;
    }

    todayItems.push({
      id: item.key,
      key: item.key,
      title: extractItemTitle(item),
      kind,
      timing,
      startsAt: item.entry.start ?? undefined,
      endsAt: item.entry.end ?? undefined,
      task,
      meta: extractItemMeta(item),
      color: extractItemColor(item),
    });
  }

  // 3. Today's dated open tasks not yet added
  for (const task of todayDatedTasks) {
    const key = `task:${task.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let timing = "Today";
    if (task.dueAt && isIsoInstant(task.dueAt)) {
      timing = `Due ${formatClockTime(task.dueAt, timeZone)}`;
    }

    todayItems.push({
      id: task.id,
      key,
      title: task.title,
      kind: task.dueAt ? "hard_deadline" : "today_task",
      timing,
      dueAt: task.dueAt ?? undefined,
      dueDate: task.dueDate ?? undefined,
      task,
      meta: task.course ?? undefined,
      isOverdue: false,
    });
  }

  return {
    now,
    next,
    todayItems,
    summary: {
      totalTodayCommitments: todayScheduleItems.filter(
        (i) => i.kind === "event" || i.kind === "external_event" || i.kind === "course_meeting",
      ).length,
      totalTodayTasks: candidateTasks.length,
      completedTodayCount: completedTasks.length,
      overdueCount: overdueTasks.length,
    },
  };
}
