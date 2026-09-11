"use client";
import { useState, useTransition } from "react";
import { CaptureItemFields } from "@/features/ai/capture-item-fields";
import type {
  ConversionReview,
  ConversionKind,
} from "@/services/integrations/ai/prediction-conversion-repository";
import {
  preparePredictionConversionAction,
  revisePredictionConversionAction,
  applyPredictionTaskAction,
  applyPredictionEventAction,
} from "./prediction-conversion-actions";
export function PredictionConversion({
  predictionId,
  disabled,
  onConverted,
}: {
  predictionId: string;
  disabled: boolean;
  onConverted: () => void;
}) {
  const [review, setReview] = useState<ConversionReview | null>(null),
    [item, setItem] = useState<ConversionReview["proposal"]["captured"] | null>(
      null,
    );
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  const dirty =
    review && JSON.stringify(item) !== JSON.stringify(review.proposal.captured);
  function run(work: () => Promise<void>) {
    start(async () => {
      setError("");
      try {
        await work();
      } catch {
        setError(
          "Review unavailable, expired, or source changed. Refresh the prediction and try again.",
        );
      }
    });
  }
  function prepare(kind: ConversionKind) {
    run(async () => {
      const r = await preparePredictionConversionAction(predictionId, kind);
      setReview(r);
      setItem(r.proposal.captured);
    });
  }
  return (
    <div>
      {!review ? (
        <>
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => prepare("task")}
          >
            Confirm as Task
          </button>
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => prepare("calendar_event")}
          >
            Confirm as Event
          </button>
        </>
      ) : (
        item && (
          <>
            <p>
              Review a new {item.entityType === "task" ? "Task" : "Event"}.
              Local time means {review.timeZone}. Approval consumes this
              prediction once.
            </p>
            <CaptureItemFields
              item={item}
              onChange={setItem}
              disabled={pending}
            />
            {dirty ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await revisePredictionConversionAction(
                      review.batchId,
                      item.entityType,
                      item,
                    );
                    setReview(r);
                    setItem(r.proposal.captured);
                  })
                }
              >
                Save edits for review
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    if (item.entityType === "task")
                      await applyPredictionTaskAction(review.batchId);
                    else await applyPredictionEventAction(review.batchId);
                    setReview(null);
                    onConverted();
                  })
                }
              >
                Create reviewed {item.entityType === "task" ? "Task" : "Event"}
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => setReview(null)}
            >
              Close review
            </button>
          </>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
