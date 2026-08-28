export const operationStatuses = ["proposed", "confirmed", "committed", "undone", "failed"] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export type OperationTarget = {
  entity: "task" | "event" | "note" | "notion_page" | "work_session";
  id: string;
};

export type OperationStep = {
  id: string;
  actionType: string;
  target: OperationTarget | null;
  /** Validated application-action input, never SQL or provider credentials. */
  input: Readonly<Record<string, unknown>>;
  /** Server-owned inverse input captured at commit time. */
  inverse: Readonly<Record<string, unknown>> | null;
};

export type OperationBatch = {
  id: string;
  source: "user" | "capture" | "ai" | "automation" | "integration";
  status: OperationStatus;
  summary: string;
  steps: readonly OperationStep[];
  createdAt: string;
  committedAt: string | null;
  undoneAt: string | null;
  undoExpiresAt: string | null;
};

/**
 * Repositories should commit a batch and its inverse records atomically. Undo
 * replays inverses in reverse order and is idempotent by batch ID.
 */
export function inverseSteps(batch: OperationBatch): readonly OperationStep[] {
  if (batch.status !== "committed") throw new Error("Only a committed operation can be undone.");
  if (batch.steps.some((step) => step.inverse === null)) {
    throw new Error("The operation does not have a complete inverse.");
  }
  return [...batch.steps].reverse();
}
