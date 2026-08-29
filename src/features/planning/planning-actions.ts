"use server";

import { revalidatePath } from "next/cache";

import { isIsoInstant } from "@/lib/date/day";
import { authFailureMessage, SupabaseNotConfiguredError } from "@/services/supabase/errors";
import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import {
  createWorkSessions,
  listWorkSessionsInRange,
  WorkSessionRepositoryError,
} from "@/services/work-sessions/work-session-repository";
import type { WorkSessionDraft } from "@/types/work-session";

export type ProposedSessionCommitInput = {
  taskId: string;
  startsAt: string;
  endsAt: string;
};

export type ApplyPlanInput = {
  sessions: ProposedSessionCommitInput[];
};

export type ApplyPlanActionResult =
  | {
      ok: true;
      createdCount: number;
      alreadyAppliedCount: number;
      totalRequested: number;
    }
  | {
      ok: false;
      message: string;
    };

class InvalidPlanningInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPlanningInputError";
  }
}

function revalidatePlanningConsumers() {
  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath("/");
}

function toFailure(error: unknown): ApplyPlanActionResult {
  if (error instanceof InvalidPlanningInputError || error instanceof WorkSessionRepositoryError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof SupabaseNotConfiguredError) {
    return {
      ok: false,
      message: "Supabase is not configured, so schedule proposals cannot be applied yet.",
    };
  }
  const authMessage = authFailureMessage(error);
  if (authMessage) return { ok: false, message: authMessage };

  console.error("[planning] apply plan action failed:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Something went wrong applying the plan. Please try again.",
  };
}

/**
 * Phase 5C Persistence Boundary:
 * Validates explicitly accepted planning proposals and commits them as native
 * task_work_sessions with source = 'planner'.
 */
export async function applyPlanAction(input: ApplyPlanInput): Promise<ApplyPlanActionResult> {
  try {
    if (!input || !Array.isArray(input.sessions)) {
      throw new InvalidPlanningInputError("Invalid plan application request.");
    }

    if (input.sessions.length === 0) {
      return {
        ok: true,
        createdCount: 0,
        alreadyAppliedCount: 0,
        totalRequested: 0,
      };
    }

    // 1. Validate structure of each session input
    for (const session of input.sessions) {
      if (typeof session?.taskId !== "string" || session.taskId.trim() === "") {
        throw new InvalidPlanningInputError("One or more sessions are missing a valid task identifier.");
      }
      if (!isIsoInstant(session?.startsAt) || !isIsoInstant(session?.endsAt)) {
        throw new InvalidPlanningInputError("One or more sessions have invalid start or end timestamps.");
      }
      const startMs = Date.parse(session.startsAt);
      const endMs = Date.parse(session.endsAt);
      if (endMs <= startMs) {
        throw new InvalidPlanningInputError("Session start time must be strictly before end time.");
      }
    }

    // 2. Authenticate user
    const { client, userId } = await requireAuthenticatedSupabase();

    // 3. Validate task existence, ownership, and active status
    const uniqueTaskIds = [...new Set(input.sessions.map((s) => s.taskId))];
    const { data: taskRows, error: taskQueryError } = await client
      .from("tasks")
      .select("id, status, user_id")
      .in("id", uniqueTaskIds)
      .eq("user_id", userId);

    if (taskQueryError) {
      console.error("[planning] task verification failed:", taskQueryError);
      throw new WorkSessionRepositoryError("Could not verify task ownership. Please try again.");
    }

    const foundTaskIds = new Set((taskRows ?? []).map((t) => t.id));
    const missingTaskIds = uniqueTaskIds.filter((id) => !foundTaskIds.has(id));
    if (missingTaskIds.length > 0) {
      throw new InvalidPlanningInputError(
        "One or more referenced tasks do not exist or belong to another owner.",
      );
    }

    for (const row of taskRows ?? []) {
      if (!["inbox", "todo", "in_progress"].includes(row.status)) {
        throw new InvalidPlanningInputError(
          "One or more tasks are no longer open (completed or cancelled) and cannot be scheduled.",
        );
      }
    }

    // 4. Check existing work sessions for idempotency / deduplication
    let minStartIso = input.sessions[0].startsAt;
    let maxEndIso = input.sessions[0].endsAt;
    for (const s of input.sessions) {
      if (Date.parse(s.startsAt) < Date.parse(minStartIso)) minStartIso = s.startsAt;
      if (Date.parse(s.endsAt) > Date.parse(maxEndIso)) maxEndIso = s.endsAt;
    }

    const existingSessions = await listWorkSessionsInRange(minStartIso, maxEndIso);

    const sessionsToInsert: WorkSessionDraft[] = [];
    let alreadyAppliedCount = 0;
    const seenInBatch = new Set<string>();

    for (const s of input.sessions) {
      const startIso = new Date(s.startsAt).toISOString();
      const endIso = new Date(s.endsAt).toISOString();
      const batchKey = `${s.taskId}:${startIso}:${endIso}`;

      if (seenInBatch.has(batchKey)) {
        alreadyAppliedCount++;
        continue;
      }
      seenInBatch.add(batchKey);

      const isDuplicate = existingSessions.some((existing) => (
        existing.taskId === s.taskId
        && new Date(existing.startsAt).getTime() === new Date(s.startsAt).getTime()
        && new Date(existing.endsAt).getTime() === new Date(s.endsAt).getTime()
        && existing.status !== "cancelled"
      ));

      if (isDuplicate) {
        alreadyAppliedCount++;
      } else {
        sessionsToInsert.push({
          taskId: s.taskId,
          startsAt: startIso,
          endsAt: endIso,
          source: "planner",
        });
      }
    }

    // 5. Persist new sessions to task_work_sessions
    if (sessionsToInsert.length > 0) {
      await createWorkSessions(sessionsToInsert);
    }

    // 6. Revalidate UI consumers
    revalidatePlanningConsumers();

    return {
      ok: true,
      createdCount: sessionsToInsert.length,
      alreadyAppliedCount,
      totalRequested: input.sessions.length,
    };
  } catch (error) {
    return toFailure(error);
  }
}
