import type { CalendarItem } from "@/features/calendar/calendar-items";
import {
  addDays,
  fromZonedInputValue,
  isIsoDate,
  isIsoInstant,
  startOfDayIn,
  todayIn,
} from "@/lib/date/day";
import type { Task } from "@/types/task";

import {
  type FixedCommitment,
  type PlanningInterval,
  type PreferredWorkWindow,
  type ProposedWorkSession,
  type SchedulableTask,
  type SchedulerInput,
  type SchedulerResult,
} from "./scheduler-contract";
import { scheduleWork } from "./scheduler-engine";

export type EnrichedProposedSession = ProposedWorkSession & {
  task: Task;
  durationMinutes: number;
  isPartial: boolean;
  totalTaskDuration: number;
  scheduledTaskMinutes: number;
};

export type UnscheduledTaskInfo = {
  task: Task;
  reason: string;
  remainingMinutes: number;
  scheduledMinutes: number;
};

export type DayPlanProposal = {
  range: PlanningInterval;
  proposedSessions: readonly EnrichedProposedSession[];
  fixedCommitments: readonly FixedCommitment[];
  fullyScheduledTasks: readonly Task[];
  partiallyScheduledTasks: readonly UnscheduledTaskInfo[];
  unscheduledTasks: readonly UnscheduledTaskInfo[];
  totalPlannedWorkMinutes: number;
  totalAvailableFreeMinutes: number;
  rawResult: SchedulerResult;
};

export type ActionRecommendation =
  | {
      kind: "active_work_session";
      headline: string;
      description: string;
      session: EnrichedProposedSession;
      task: Task;
      endsAt: string;
      remainingMinutes: number;
    }
  | {
      kind: "imminent_commitment";
      headline: string;
      description: string;
      commitment: FixedCommitment;
      startsAt: string;
      minutesUntilStart: number;
    }
  | {
      kind: "next_up_session";
      headline: string;
      description: string;
      session: EnrichedProposedSession;
      task: Task;
      startsAt: string;
      minutesUntilStart: number;
    }
  | {
      kind: "top_priority_task";
      headline: string;
      description: string;
      task: Task;
      estimatedMinutes: number;
    }
  | {
      kind: "schedule_clear";
      headline: string;
      description: string;
    }
  | {
      kind: "no_tasks";
      headline: string;
      description: string;
    }
  | {
      kind: "no_schedulable_fit";
      headline: string;
      description: string;
      reasons: readonly string[];
    };

export type AssemblePlanningInputParams = {
  tasks: readonly Task[];
  scheduleItems?: readonly CalendarItem[];
  timeZone: string;
  date?: string;
  rangeStartHour?: number;
  rangeEndHour?: number;
  breakMinutes?: number;
  bufferMinutes?: number;
  preferredWorkWindows?: readonly PreferredWorkWindow[];
  taskDurationOverrides?: Record<string, number>;
};

export function estimateTaskDuration(task: Task, override?: number): number {
  if (override && override > 0) return override;

  if (task.scheduledStart && task.scheduledEnd) {
    const diff = Math.round((Date.parse(task.scheduledEnd) - Date.parse(task.scheduledStart)) / 60_000);
    if (diff > 0) return diff;
  }

  switch (task.priority) {
    case "urgent":
      return 60;
    case "high":
      return 60;
    case "medium":
      return 45;
    case "low":
      return 30;
    case "none":
    default:
      return 30;
  }
}

export function priorityToNumeric(priority: Task["priority"]): number {
  switch (priority) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    case "none":
    default:
      return 0;
  }
}

export function isOpenTask(task: Task): boolean {
  return task.status === "inbox" || task.status === "todo" || task.status === "in_progress";
}

/**
 * Assembles a deterministic SchedulerInput from application-layer models.
 */
export function assembleSchedulerInput(params: AssemblePlanningInputParams): SchedulerInput {
  const {
    tasks,
    scheduleItems = [],
    timeZone,
    date = todayIn(timeZone),
    rangeStartHour = 8,
    rangeEndHour = 22,
    breakMinutes = 10,
    bufferMinutes = 10,
    preferredWorkWindows,
    taskDurationOverrides = {},
  } = params;

  const startHourStr = String(rangeStartHour).padStart(2, "0");
  const endHourStr = String(rangeEndHour).padStart(2, "0");

  const rangeStartIso = fromZonedInputValue(`${date}T${startHourStr}:00`, timeZone);
  const rangeEndIso = fromZonedInputValue(`${date}T${endHourStr}:00`, timeZone);

  const range: PlanningInterval = {
    id: `planning-range:${date}`,
    startsAt: rangeStartIso,
    endsAt: rangeEndIso,
  };

  // Convert calendar items to fixed commitments
  const fixedCommitments: FixedCommitment[] = [];
  for (const item of scheduleItems) {
    const entry = item.entry;
    if (entry.allDay) {
      // Whole-day item
      const itemStartIso = startOfDayIn(item.date, timeZone).toISOString();
      const itemEndIso = startOfDayIn(addDays(item.date, 1), timeZone).toISOString();
      fixedCommitments.push({
        id: `fixed:${item.key}`,
        startsAt: itemStartIso,
        endsAt: itemEndIso,
        source: "forward_event",
      });
      continue;
    }

    if (entry.start && entry.end) {
      let source: FixedCommitment["source"] = "forward_event";
      if (item.kind === "external_event") {
        source = "external_event";
      } else if (item.kind === "work_session" || item.kind === "scheduled_task") {
        source = "protected_time";
      }

      fixedCommitments.push({
        id: `fixed:${item.key}`,
        startsAt: new Date(entry.start).toISOString(),
        endsAt: new Date(entry.end).toISOString(),
        source,
      });
    }
  }

  // Convert open tasks to SchedulableTask
  const openTasks = tasks.filter(isOpenTask);
  const schedulableTasks: SchedulableTask[] = [];

  for (const task of openTasks) {
    const duration = estimateTaskDuration(task, taskDurationOverrides[task.id]);

    let deadline = rangeEndIso;
    if (task.dueAt && isIsoInstant(task.dueAt)) {
      deadline = new Date(task.dueAt).toISOString();
    } else if (task.dueDate && isIsoDate(task.dueDate)) {
      deadline = fromZonedInputValue(`${task.dueDate}T23:59`, timeZone);
    }

    let earliestStart = rangeStartIso;
    if (task.scheduledStart && isIsoInstant(task.scheduledStart)) {
      earliestStart = new Date(task.scheduledStart).toISOString();
    }

    const splittable = duration >= 45;
    const minimumSessionMinutes = splittable ? Math.min(30, duration) : duration;

    schedulableTasks.push({
      taskId: task.id,
      deadline,
      durationMinutes: duration,
      priority: priorityToNumeric(task.priority),
      earliestStart,
      splittable,
      minimumSessionMinutes,
    });
  }

  // Default preferred windows if none provided: Morning (09:00 - 12:00 weight 2), Afternoon (14:00 - 17:00 weight 1)
  const defaultPreferredWindows: readonly PreferredWorkWindow[] = preferredWorkWindows ?? [
    {
      id: `pref-morning:${date}`,
      startsAt: fromZonedInputValue(`${date}T09:00`, timeZone),
      endsAt: fromZonedInputValue(`${date}T12:00`, timeZone),
      weight: 2,
    },
    {
      id: `pref-afternoon:${date}`,
      startsAt: fromZonedInputValue(`${date}T14:00`, timeZone),
      endsAt: fromZonedInputValue(`${date}T17:00`, timeZone),
      weight: 1,
    },
  ];

  return {
    range,
    fixedCommitments,
    preferredWorkWindows: defaultPreferredWindows,
    tasks: schedulableTasks,
    breakMinutes,
    bufferMinutes,
  };
}

/**
 * Generates a full day planning proposal using the Phase 5A scheduling engine.
 */
export function generateDayPlan(
  params: AssemblePlanningInputParams,
): DayPlanProposal {
  const schedulerInput = assembleSchedulerInput(params);
  const rawResult = scheduleWork(schedulerInput);

  const taskMap = new Map<string, Task>();
  for (const t of params.tasks) {
    taskMap.set(t.id, t);
  }

  // Aggregate scheduled durations per task
  const scheduledMinutesByTaskId = new Map<string, number>();
  for (const session of rawResult.sessions) {
    const dur = Math.round((Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000);
    scheduledMinutesByTaskId.set(session.taskId, (scheduledMinutesByTaskId.get(session.taskId) ?? 0) + dur);
  }

  const enrichedSessions: EnrichedProposedSession[] = rawResult.sessions.map((session) => {
    const task = taskMap.get(session.taskId)!;
    const dur = Math.round((Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000);
    const totalDuration = estimateTaskDuration(task, params.taskDurationOverrides?.[task.id]);
    const scheduledTotal = scheduledMinutesByTaskId.get(session.taskId) ?? dur;
    const isPartial = scheduledTotal < totalDuration;

    return {
      ...session,
      task,
      durationMinutes: dur,
      isPartial,
      totalTaskDuration: totalDuration,
      scheduledTaskMinutes: scheduledTotal,
    };
  });

  const unscheduledMap = new Map<string, string>();
  for (const u of rawResult.unscheduled) {
    unscheduledMap.set(u.taskId, u.reason);
  }

  const fullyScheduledTasks: Task[] = [];
  const partiallyScheduledTasks: UnscheduledTaskInfo[] = [];
  const unscheduledTasks: UnscheduledTaskInfo[] = [];

  const openTasks = params.tasks.filter(isOpenTask);
  for (const task of openTasks) {
    const scheduledMins = scheduledMinutesByTaskId.get(task.id) ?? 0;
    const totalDuration = estimateTaskDuration(task, params.taskDurationOverrides?.[task.id]);

    if (scheduledMins === totalDuration && scheduledMins > 0) {
      fullyScheduledTasks.push(task);
    } else if (scheduledMins > 0 && scheduledMins < totalDuration) {
      partiallyScheduledTasks.push({
        task,
        reason: unscheduledMap.get(task.id) ?? "Partial time allocated before constraints.",
        remainingMinutes: totalDuration - scheduledMins,
        scheduledMinutes: scheduledMins,
      });
    } else {
      unscheduledTasks.push({
        task,
        reason: unscheduledMap.get(task.id) ?? "Could not fit in available schedule.",
        remainingMinutes: totalDuration,
        scheduledMinutes: 0,
      });
    }
  }

  const totalPlannedWorkMinutes = enrichedSessions.reduce((acc, s) => acc + s.durationMinutes, 0);

  const rangeDurationMinutes = Math.round(
    (Date.parse(schedulerInput.range.endsAt) - Date.parse(schedulerInput.range.startsAt)) / 60_000,
  );

  return {
    range: schedulerInput.range,
    proposedSessions: enrichedSessions,
    fixedCommitments: schedulerInput.fixedCommitments,
    fullyScheduledTasks,
    partiallyScheduledTasks,
    unscheduledTasks,
    totalPlannedWorkMinutes,
    totalAvailableFreeMinutes: Math.max(0, rangeDurationMinutes - totalPlannedWorkMinutes),
    rawResult,
  };
}

/**
 * Deterministically computes "What Should I Do Now?" from day plan and current instant.
 */
export function getWhatShouldIDoNow(
  dayPlan: DayPlanProposal,
  nowIso: string = new Date().toISOString(),
  timeZone: string = "Asia/Manila",
): ActionRecommendation {
  const totalTasks = dayPlan.fullyScheduledTasks.length
    + dayPlan.partiallyScheduledTasks.length
    + dayPlan.unscheduledTasks.length;

  if (totalTasks === 0) {
    return {
      kind: "no_tasks",
      headline: "No open tasks",
      description: "You have no outstanding tasks to work on in this workspace.",
    };
  }

  const nowMs = Date.parse(nowIso);

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

  // 1. Check for Active Proposed Work Session right now
  const activeSession = dayPlan.proposedSessions.find((s) => {
    const start = Date.parse(s.startsAt);
    const end = Date.parse(s.endsAt);
    return nowMs >= start && nowMs < end;
  });

  if (activeSession) {
    const remainingMinutes = Math.max(1, Math.round((Date.parse(activeSession.endsAt) - nowMs) / 60_000));
    return {
      kind: "active_work_session",
      headline: `Focus: ${activeSession.task.title}`,
      description: `Active scheduled session (${remainingMinutes}m remaining until ${timeFormatter.format(new Date(activeSession.endsAt))}).`,
      session: activeSession,
      task: activeSession.task,
      endsAt: activeSession.endsAt,
      remainingMinutes,
    };
  }

  // 2. Check for Imminent Fixed Commitment (starting in <= 20 minutes)
  const imminentCommitment = dayPlan.fixedCommitments.find((c) => {
    const start = Date.parse(c.startsAt);
    return start > nowMs && start - nowMs <= 20 * 60_000;
  });

  if (imminentCommitment) {
    const minutesUntilStart = Math.max(1, Math.round((Date.parse(imminentCommitment.startsAt) - nowMs) / 60_000));
    return {
      kind: "imminent_commitment",
      headline: `Upcoming commitment in ${minutesUntilStart}m`,
      description: `Starts at ${timeFormatter.format(new Date(imminentCommitment.startsAt))}. Wrap up or prepare.`,
      commitment: imminentCommitment,
      startsAt: imminentCommitment.startsAt,
      minutesUntilStart,
    };
  }

  // 3. Check for Next Up Proposed Work Session
  const nextSession = dayPlan.proposedSessions.find((s) => Date.parse(s.startsAt) > nowMs);
  if (nextSession) {
    const minutesUntilStart = Math.max(1, Math.round((Date.parse(nextSession.startsAt) - nowMs) / 60_000));
    return {
      kind: "next_up_session",
      headline: `Next: ${nextSession.task.title}`,
      description: `Scheduled at ${timeFormatter.format(new Date(nextSession.startsAt))} (${minutesUntilStart}m from now · ${nextSession.durationMinutes}m duration).`,
      session: nextSession,
      task: nextSession.task,
      startsAt: nextSession.startsAt,
      minutesUntilStart,
    };
  }

  // 4. If all tasks are scheduled and finished for today
  if (dayPlan.unscheduledTasks.length === 0 && dayPlan.partiallyScheduledTasks.length === 0) {
    return {
      kind: "schedule_clear",
      headline: "All caught up",
      description: "All planned work for today is complete. Your schedule is clear.",
    };
  }

  // 5. If there are unscheduled tasks, recommend the highest priority task
  const openUnscheduled = [...dayPlan.partiallyScheduledTasks, ...dayPlan.unscheduledTasks]
    .sort((a, b) => priorityToNumeric(b.task.priority) - priorityToNumeric(a.task.priority));

  if (openUnscheduled.length > 0) {
    const top = openUnscheduled[0];
    return {
      kind: "top_priority_task",
      headline: `Recommended: ${top.task.title}`,
      description: `High-priority work ready for your focus (${top.remainingMinutes}m remaining).`,
      task: top.task,
      estimatedMinutes: top.remainingMinutes,
    };
  }

  return {
    kind: "no_schedulable_fit",
    headline: "No suitable task fits right now",
    description: "Remaining tasks have tight deadlines or conflicting commitments.",
    reasons: dayPlan.unscheduledTasks.map((u) => `${u.task.title}: ${u.reason}`),
  };
}
