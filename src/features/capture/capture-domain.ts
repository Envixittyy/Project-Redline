export const captureKinds = [
  "text",
  "pasted_text",
  "image",
  "screenshot",
  "photo",
  "file",
  "link",
] as const;

export const captureStages = [
  "captured",
  "interpreted",
  "proposed",
  "confirmed",
  "committed",
  "undone",
  "failed",
] as const;

export type CaptureKind = (typeof captureKinds)[number];
export type CaptureStage = (typeof captureStages)[number];

export type RawCaptureContent =
  | { kind: "text" | "pasted_text"; text: string }
  | { kind: "link"; url: string; label?: string }
  | {
      kind: "image" | "screenshot" | "photo" | "file";
      objectKey: string;
      mediaType: string;
      originalName?: string;
    };

/** Raw input is immutable evidence. Structured objects are created separately. */
export type RawCapture = {
  id: string;
  capturedAt: string;
  stage: CaptureStage;
  content: RawCaptureContent;
  interpretationId: string | null;
  operationBatchId: string | null;
  errorCode: string | null;
};

export type CaptureInterpretation = {
  id: string;
  captureId: string;
  createdAt: string;
  source: "deterministic" | "ai" | "manual";
  /** IDs reference typed proposals; this record never contains executable SQL. */
  proposalIds: readonly string[];
};

export type CaptureProposal = {
  id: string;
  captureId: string;
  action: "create_task";
  status: "proposed" | "confirmed" | "committed" | "rejected";
  title: string;
  createdAt: string;
};

export type CaptureInboxItem = RawCapture & {
  proposal: CaptureProposal | null;
  undoExpiresAt: string | null;
};

export type CaptureEvent =
  | { type: "interpret"; interpretationId: string }
  | { type: "propose" }
  | { type: "confirm" }
  | { type: "commit"; operationBatchId: string }
  | { type: "undo" }
  | { type: "fail"; errorCode: string };

const transitions: Record<CaptureStage, readonly CaptureEvent["type"][]> = {
  captured: ["interpret", "fail"],
  interpreted: ["propose", "fail"],
  proposed: ["confirm", "fail"],
  confirmed: ["commit", "fail"],
  committed: ["undo"],
  undone: [],
  failed: ["interpret"],
};

export class CaptureTransitionError extends Error {
  constructor(from: CaptureStage, event: CaptureEvent["type"]) {
    super(`Capture cannot transition from ${from} with ${event}.`);
    this.name = "CaptureTransitionError";
  }
}

/**
 * Deterministic state transition for CAPTURE → INTERPRET → PROPOSE → CONFIRM
 * → COMMIT → UNDO. Persisting the returned record belongs to a repository.
 */
export function transitionCapture(capture: RawCapture, event: CaptureEvent): RawCapture {
  if (!transitions[capture.stage].includes(event.type)) {
    throw new CaptureTransitionError(capture.stage, event.type);
  }

  switch (event.type) {
    case "interpret":
      return {
        ...capture,
        stage: "interpreted",
        interpretationId: event.interpretationId,
        errorCode: null,
      };
    case "propose":
      return { ...capture, stage: "proposed" };
    case "confirm":
      return { ...capture, stage: "confirmed" };
    case "commit":
      return { ...capture, stage: "committed", operationBatchId: event.operationBatchId };
    case "undo":
      return { ...capture, stage: "undone" };
    case "fail":
      return { ...capture, stage: "failed", errorCode: event.errorCode };
  }
}

/** Basic, AI-independent capture always lands in Inbox as raw text. */
export function createInboxTextCapture(id: string, text: string, capturedAt: string): RawCapture {
  const normalized = text.trim();
  if (!normalized) throw new Error("Capture text cannot be empty.");
  if (normalized.length > 10000) throw new Error("Capture text is limited to 10,000 characters.");
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error("Capture time must be an ISO instant.");

  return {
    id,
    capturedAt: new Date(capturedAt).toISOString(),
    stage: "captured",
    content: { kind: "text", text: normalized },
    interpretationId: null,
    operationBatchId: null,
    errorCode: null,
  };
}

/** P2's deterministic interpretation: the first useful line becomes an editable task title. */
export function captureTextTaskTitle(capture: RawCapture): string {
  if (capture.content.kind !== "text" && capture.content.kind !== "pasted_text") {
    throw new Error("Only text captures can become tasks in this phase.");
  }

  const firstLine = capture.content.text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .find(Boolean);

  if (!firstLine) throw new Error("Capture text cannot be empty.");
  return firstLine.slice(0, 200);
}
