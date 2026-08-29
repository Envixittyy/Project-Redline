import { describe, expect, it } from "vitest";

import {
  CaptureTransitionError,
  captureTextTaskTitle,
  createInboxTextCapture,
  transitionCapture,
  type CaptureProposal,
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

  it("derives a bounded task title from the first useful line", () => {
    const capture = createInboxTextCapture(
      "capture-1",
      `\n  Finish   the lab  \nBring the notebook`,
      "2026-08-29T08:00:00Z",
    );

    expect(captureTextTaskTitle(capture)).toBe("Finish the lab");
  });

  it("rejects text beyond the storage contract", () => {
    expect(() =>
      createInboxTextCapture("capture-1", "x".repeat(10001), "2026-08-29T08:00:00Z"),
    ).toThrow("10,000");
  });

  it("represents Blackboard external proposal metadata accurately", () => {
    const proposal: CaptureProposal = {
      id: "prop-1",
      captureId: "cap-1",
      action: "create_task",
      status: "proposed",
      title: "Problem Set 4",
      description: "Complete all questions",
      dueDate: "2026-10-20",
      dueAt: "2026-10-20T23:59:00.000Z",
      duePrecision: "instant",
      courseId: "course-123",
      external: {
        provider: "blackboard",
        externalRecordId: "ext-1",
        sourceUid: "bb-item-4",
        sourceUrl: "https://learn.example.edu/ps4",
        courseCode: "MATH201",
        courseId: "course-123",
        courseName: "Linear Algebra",
        courseColor: "#2563eb",
        dueDate: "2026-10-20",
        dueAt: "2026-10-20T23:59:00.000Z",
        duePrecision: "instant",
        description: "Complete all questions",
        sourceRevision: "rev-1",
        reviewedSourceRevision: null,
        isDivergent: false,
        isMissing: false,
      },
      createdAt: "2026-08-29T08:00:00Z",
    };

    expect(proposal.external?.provider).toBe("blackboard");
    expect(proposal.external?.isDivergent).toBe(false);
    expect(proposal.external?.duePrecision).toBe("instant");
  });
});
