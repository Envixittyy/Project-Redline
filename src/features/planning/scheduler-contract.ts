export type PlanningInterval = {
  id: string;
  startsAt: string;
  endsAt: string;
};

export type FixedCommitment = PlanningInterval & {
  source: "forward_event" | "external_event" | "blackboard_event" | "protected_time";
};

export type PreferredWorkWindow = PlanningInterval & {
  weight: number;
};

export type SchedulableTask = {
  taskId: string;
  deadline: string;
  durationMinutes: number;
  priority: number;
  earliestStart: string;
  splittable: boolean;
  minimumSessionMinutes: number;
};

export type SchedulerInput = {
  range: PlanningInterval;
  fixedCommitments: readonly FixedCommitment[];
  preferredWorkWindows: readonly PreferredWorkWindow[];
  tasks: readonly SchedulableTask[];
  breakMinutes: number;
  bufferMinutes: number;
};

export type ProposedWorkSession = PlanningInterval & {
  taskId: string;
};

export type SchedulerResult = {
  sessions: readonly ProposedWorkSession[];
  unscheduled: readonly { taskId: string; reason: string }[];
};

function validInterval(interval: PlanningInterval): boolean {
  return !Number.isNaN(Date.parse(interval.startsAt))
    && !Number.isNaN(Date.parse(interval.endsAt))
    && Date.parse(interval.startsAt) < Date.parse(interval.endsAt);
}

/** Validate deterministic inputs before any scheduling algorithm runs. */
export function validateSchedulerInput(input: SchedulerInput): readonly string[] {
  const issues: string[] = [];
  if (!validInterval(input.range)) issues.push("range must be a valid increasing interval.");
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0) {
    issues.push("breakMinutes must be a non-negative integer.");
  }
  if (!Number.isInteger(input.bufferMinutes) || input.bufferMinutes < 0) {
    issues.push("bufferMinutes must be a non-negative integer.");
  }
  for (const commitment of input.fixedCommitments) {
    if (!validInterval(commitment)) issues.push(`fixed commitment ${commitment.id} is invalid.`);
  }
  for (const window of input.preferredWorkWindows) {
    if (!validInterval(window) || !Number.isFinite(window.weight) || window.weight < 0) {
      issues.push(`preferred window ${window.id} is invalid.`);
    }
  }
  for (const task of input.tasks) {
    if (Number.isNaN(Date.parse(task.deadline)) || Number.isNaN(Date.parse(task.earliestStart))) {
      issues.push(`task ${task.taskId} has an invalid scheduling instant.`);
    }
    if (!Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0) {
      issues.push(`task ${task.taskId} has an invalid duration.`);
    }
    if (!Number.isInteger(task.minimumSessionMinutes) || task.minimumSessionMinutes <= 0) {
      issues.push(`task ${task.taskId} has an invalid minimum session duration.`);
    }
    if (!task.splittable && task.minimumSessionMinutes !== task.durationMinutes) {
      issues.push(`unsplittable task ${task.taskId} must use its full duration as the minimum.`);
    }
  }
  return issues;
}

/** Stable ordering removes model/provider nondeterminism from later engines. */
export function orderTasksForScheduling(tasks: readonly SchedulableTask[]): SchedulableTask[] {
  return [...tasks].sort((left, right) => (
    right.priority - left.priority
    || Date.parse(left.deadline) - Date.parse(right.deadline)
    || left.taskId.localeCompare(right.taskId)
  ));
}

export { schedule, scheduleWork } from "./scheduler-engine";
