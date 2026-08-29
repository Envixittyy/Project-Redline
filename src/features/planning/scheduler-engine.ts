import {
  type FixedCommitment,
  type PreferredWorkWindow,
  type ProposedWorkSession,
  type SchedulerInput,
  type SchedulerResult,
  orderTasksForScheduling,
  validateSchedulerInput,
} from "./scheduler-contract";

type TimeInterval = {
  startMs: number;
  endMs: number;
};

type WeightedSlot = {
  startMs: number;
  endMs: number;
  durationMinutes: number;
  weight: number;
};

function computeBusyIntervals(
  commitments: readonly FixedCommitment[],
  bufferMinutes: number,
  rangeStartMs: number,
  rangeEndMs: number,
): TimeInterval[] {
  const bufferMs = bufferMinutes * 60_000;
  const rawBusy: TimeInterval[] = [];

  for (const commitment of commitments) {
    const cStart = Date.parse(commitment.startsAt);
    const cEnd = Date.parse(commitment.endsAt);
    if (Number.isNaN(cStart) || Number.isNaN(cEnd) || cStart >= cEnd) continue;

    const bStart = Math.max(rangeStartMs, cStart - bufferMs);
    const bEnd = Math.min(rangeEndMs, cEnd + bufferMs);

    if (bStart < bEnd) {
      rawBusy.push({ startMs: bStart, endMs: bEnd });
    }
  }

  rawBusy.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: TimeInterval[] = [];
  for (const interval of rawBusy) {
    if (merged.length === 0) {
      merged.push({ ...interval });
    } else {
      const prev = merged[merged.length - 1];
      if (interval.startMs <= prev.endMs) {
        prev.endMs = Math.max(prev.endMs, interval.endMs);
      } else {
        merged.push({ ...interval });
      }
    }
  }

  return merged;
}

function deriveFreeIntervals(
  busyIntervals: readonly TimeInterval[],
  rangeStartMs: number,
  rangeEndMs: number,
): TimeInterval[] {
  const free: TimeInterval[] = [];
  let currentStart = rangeStartMs;

  for (const busy of busyIntervals) {
    if (busy.startMs > currentStart) {
      free.push({ startMs: currentStart, endMs: busy.startMs });
    }
    currentStart = Math.max(currentStart, busy.endMs);
  }

  if (currentStart < rangeEndMs) {
    free.push({ startMs: currentStart, endMs: rangeEndMs });
  }

  return free;
}

function subtractInterval(
  intervals: readonly TimeInterval[],
  toRemove: TimeInterval,
): TimeInterval[] {
  const result: TimeInterval[] = [];

  for (const interval of intervals) {
    if (toRemove.endMs <= interval.startMs || toRemove.startMs >= interval.endMs) {
      result.push({ ...interval });
    } else {
      if (toRemove.startMs > interval.startMs) {
        result.push({ startMs: interval.startMs, endMs: toRemove.startMs });
      }
      if (toRemove.endMs < interval.endMs) {
        result.push({ startMs: toRemove.endMs, endMs: interval.endMs });
      }
    }
  }

  return result.filter((inv) => inv.startMs < inv.endMs);
}

function getWeightedSlotsForTask(
  availableIntervals: readonly TimeInterval[],
  preferredWindows: readonly PreferredWorkWindow[],
  taskStartLimitMs: number,
  taskEndLimitMs: number,
): WeightedSlot[] {
  const eligibleIntervals: TimeInterval[] = [];
  for (const inv of availableIntervals) {
    const s = Math.max(inv.startMs, taskStartLimitMs);
    const e = Math.min(inv.endMs, taskEndLimitMs);
    if (s < e) {
      eligibleIntervals.push({ startMs: s, endMs: e });
    }
  }

  if (eligibleIntervals.length === 0) return [];
  if (preferredWindows.length === 0) {
    return eligibleIntervals.map((inv) => ({
      startMs: inv.startMs,
      endMs: inv.endMs,
      durationMinutes: Math.floor((inv.endMs - inv.startMs) / 60_000),
      weight: 0,
    }));
  }

  const validWindows = preferredWindows
    .map((w) => ({
      startMs: Date.parse(w.startsAt),
      endMs: Date.parse(w.endsAt),
      weight: w.weight,
    }))
    .filter((w) => !Number.isNaN(w.startMs) && !Number.isNaN(w.endMs) && w.startMs < w.endMs);

  const weightedSlots: WeightedSlot[] = [];

  for (const inv of eligibleIntervals) {
    const boundaries = new Set<number>([inv.startMs, inv.endMs]);
    for (const w of validWindows) {
      if (w.startMs > inv.startMs && w.startMs < inv.endMs) {
        boundaries.add(w.startMs);
      }
      if (w.endMs > inv.startMs && w.endMs < inv.endMs) {
        boundaries.add(w.endMs);
      }
    }

    const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
    const subSegments: WeightedSlot[] = [];

    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const segStart = sortedBoundaries[i];
      const segEnd = sortedBoundaries[i + 1];
      if (segStart >= segEnd) continue;

      let maxWeight = 0;
      for (const w of validWindows) {
        if (w.startMs <= segStart && w.endMs >= segEnd) {
          if (w.weight > maxWeight) {
            maxWeight = w.weight;
          }
        }
      }

      subSegments.push({
        startMs: segStart,
        endMs: segEnd,
        durationMinutes: Math.floor((segEnd - segStart) / 60_000),
        weight: maxWeight,
      });
    }

    for (const seg of subSegments) {
      if (weightedSlots.length === 0) {
        weightedSlots.push({ ...seg });
      } else {
        const last = weightedSlots[weightedSlots.length - 1];
        if (last.endMs === seg.startMs && last.weight === seg.weight) {
          last.endMs = seg.endMs;
          last.durationMinutes += seg.durationMinutes;
        } else {
          weightedSlots.push({ ...seg });
        }
      }
    }
  }

  return weightedSlots;
}

function calculateSplittableAllocation(
  availableMinutes: number,
  remainingMinutes: number,
  minimumSessionMinutes: number,
  allowPartialRemainder: boolean,
): number {
  if (availableMinutes < minimumSessionMinutes) return 0;
  if (availableMinutes >= remainingMinutes) return remainingMinutes;

  const maxTake = Math.floor(availableMinutes);
  if (maxTake < minimumSessionMinutes) return 0;

  const remainder = remainingMinutes - maxTake;
  if (remainder >= minimumSessionMinutes) {
    return maxTake;
  }

  const adjustedTake = remainingMinutes - minimumSessionMinutes;
  if (adjustedTake >= minimumSessionMinutes && adjustedTake <= maxTake) {
    return adjustedTake;
  }

  if (allowPartialRemainder) {
    return maxTake;
  }

  return 0;
}

/**
 * Pure, deterministic mathematical scheduling engine.
 *
 * Operates strictly on `SchedulerInput` and returns structured `SchedulerResult`
 * proposals and unscheduled reasons without side-effects or external dependencies.
 */
export function scheduleWork(input: SchedulerInput): SchedulerResult {
  const validationIssues = validateSchedulerInput(input);
  if (validationIssues.length > 0) {
    return {
      sessions: [],
      unscheduled: input.tasks.map((task) => ({
        taskId: task.taskId,
        reason: `Input validation failed: ${validationIssues.join("; ")}`,
      })),
    };
  }

  const rangeStartMs = Date.parse(input.range.startsAt);
  const rangeEndMs = Date.parse(input.range.endsAt);

  if (rangeStartMs >= rangeEndMs) {
    return {
      sessions: [],
      unscheduled: input.tasks.map((task) => ({
        taskId: task.taskId,
        reason: "Planning range interval is invalid.",
      })),
    };
  }

  const busyIntervals = computeBusyIntervals(
    input.fixedCommitments,
    input.bufferMinutes,
    rangeStartMs,
    rangeEndMs,
  );

  let availableIntervals = deriveFreeIntervals(busyIntervals, rangeStartMs, rangeEndMs);

  const orderedTasks = orderTasksForScheduling(input.tasks);
  const breakMs = input.breakMinutes * 60_000;
  const proposedSessions: ProposedWorkSession[] = [];
  const unscheduled: { taskId: string; reason: string }[] = [];

  for (const task of orderedTasks) {
    const taskEarliestMs = Date.parse(task.earliestStart);
    const taskDeadlineMs = Date.parse(task.deadline);

    const taskStartLimit = Math.max(rangeStartMs, taskEarliestMs);
    const taskEndLimit = Math.min(rangeEndMs, taskDeadlineMs);

    if (taskStartLimit >= taskEndLimit) {
      unscheduled.push({
        taskId: task.taskId,
        reason: taskEarliestMs >= taskDeadlineMs
          ? `Earliest start (${task.earliestStart}) is at or after deadline (${task.deadline}).`
          : "Task scheduling window does not intersect with the planning range.",
      });
      continue;
    }

    let remainingMinutes = task.durationMinutes;
    const taskSessions: ProposedWorkSession[] = [];

    if (!task.splittable) {
      // Unsplittable task requires a single contiguous slot of task.durationMinutes
      // First, check candidate weighted slots ordered by weight desc, startMs asc
      const weightedSlots = getWeightedSlotsForTask(
        availableIntervals,
        input.preferredWorkWindows,
        taskStartLimit,
        taskEndLimit,
      ).sort((a, b) => b.weight - a.weight || a.startMs - b.startMs);

      let chosenStartMs: number | null = null;

      for (const slot of weightedSlots) {
        if (slot.durationMinutes >= task.durationMinutes) {
          chosenStartMs = slot.startMs;
          break;
        }
      }

      // If no single weighted slot had the full duration, check raw contiguous available intervals
      if (chosenStartMs === null) {
        for (const inv of availableIntervals) {
          const s = Math.max(inv.startMs, taskStartLimit);
          const e = Math.min(inv.endMs, taskEndLimit);
          const dur = Math.floor((e - s) / 60_000);
          if (dur >= task.durationMinutes) {
            chosenStartMs = s;
            break;
          }
        }
      }

      if (chosenStartMs !== null) {
        const sessionEndMs = chosenStartMs + task.durationMinutes * 60_000;
        const session: ProposedWorkSession = {
          id: `session-${task.taskId}-1`,
          taskId: task.taskId,
          startsAt: new Date(chosenStartMs).toISOString(),
          endsAt: new Date(sessionEndMs).toISOString(),
        };

        taskSessions.push(session);
        remainingMinutes = 0;

        // Consume allocated session plus break
        availableIntervals = subtractInterval(availableIntervals, {
          startMs: chosenStartMs,
          endMs: sessionEndMs + breakMs,
        });
      }
    } else {
      // Splittable task
      // First pass: try to schedule with full remainder validity
      // If remainingMinutes > 0 after passes, try fallback with partial remainder
      for (const allowPartialRemainder of [false, true]) {
        if (remainingMinutes === 0) break;

        let madeProgress = true;
        while (madeProgress && remainingMinutes > 0) {
          madeProgress = false;

          const weightedSlots = getWeightedSlotsForTask(
            availableIntervals,
            input.preferredWorkWindows,
            taskStartLimit,
            taskEndLimit,
          ).sort((a, b) => b.weight - a.weight || a.startMs - b.startMs);

          for (const slot of weightedSlots) {
            const alloc = calculateSplittableAllocation(
              slot.durationMinutes,
              remainingMinutes,
              task.minimumSessionMinutes,
              allowPartialRemainder,
            );

            if (alloc > 0) {
              const sessionIndex = taskSessions.length + 1;
              const sessionStartMs = slot.startMs;
              const sessionEndMs = sessionStartMs + alloc * 60_000;

              const session: ProposedWorkSession = {
                id: `session-${task.taskId}-${sessionIndex}`,
                taskId: task.taskId,
                startsAt: new Date(sessionStartMs).toISOString(),
                endsAt: new Date(sessionEndMs).toISOString(),
              };

              taskSessions.push(session);
              remainingMinutes -= alloc;

              availableIntervals = subtractInterval(availableIntervals, {
                startMs: sessionStartMs,
                endMs: sessionEndMs + breakMs,
              });

              madeProgress = true;
              break;
            }
          }
        }
      }
    }

    if (taskSessions.length > 0) {
      proposedSessions.push(...taskSessions);
    }

    if (remainingMinutes === 0) {
      // Fully scheduled
    } else if (taskSessions.length > 0) {
      const scheduledMinutes = task.durationMinutes - remainingMinutes;
      unscheduled.push({
        taskId: task.taskId,
        reason: `Partially scheduled: ${scheduledMinutes} of ${task.durationMinutes} minutes placed (${remainingMinutes} minutes remaining due to time constraints).`,
      });
    } else {
      unscheduled.push({
        taskId: task.taskId,
        reason: `No available time window of at least ${task.minimumSessionMinutes} minutes found before deadline.`,
      });
    }
  }

  // Stable ordering of returned sessions by startsAt ascending, then taskId ascending
  proposedSessions.sort((a, b) => (
    Date.parse(a.startsAt) - Date.parse(b.startsAt)
    || a.taskId.localeCompare(b.taskId)
  ));

  return {
    sessions: proposedSessions,
    unscheduled,
  };
}

export const schedule = scheduleWork;
