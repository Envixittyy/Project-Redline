import { describe, expect, it } from "vitest";

import {
  CaptureTransitionError,
  createInboxTextCapture,
  transitionCapture,
} from "./capture-domain";

describe("capture domain", () => {
  it("supports the explicit review and reversible commit flow", () => {
    const capture = createInboxTextCapture("capture-1", "  Finish the lab  ", "2026-08-29T08:00:00Z");
    const interpreted = transitionCapture(capture, {
      type: "interpret",
      interpretationId: "interpretation-1",
    });
    const proposed = transitionCapture(interpreted, { type: "propose" });
    const confirmed = transitionCapture(proposed, { type: "confirm" });
    const committed = transitionCapture(confirmed, { type: "commit", operationBatchId: "batch-1" });

    expect(capture.content).toEqual({ kind: "text", text: "Finish the lab" });
    expect(committed.stage).toBe("committed");
    expect(transitionCapture(committed, { type: "undo" }).stage).toBe("undone");
  });

  it("does not allow a proposal to skip review", () => {
    const capture = createInboxTextCapture("capture-1", "Finish the lab", "2026-08-29T08:00:00Z");
    expect(() => transitionCapture(capture, { type: "commit", operationBatchId: "batch-1" }))
      .toThrow(CaptureTransitionError);
  });
});
