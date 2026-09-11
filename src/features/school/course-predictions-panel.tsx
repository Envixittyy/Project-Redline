"use client";

import {
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type { SchoolAssessmentPrediction } from "@/services/school/prediction-service";
import type {
  AssessmentPredictionReview,
  ProposedPrediction,
} from "@/services/integrations/ai/assessment-prediction-contract";
import {
  getCoursePredictionsAction,
  dismissPredictionAction,
  confirmPredictionAsTaskAction,
  reviseAssessmentPredictionsAction,
  applyAssessmentPredictionsAction,
} from "./prediction-actions";
import { SCHOOL_INTELLIGENCE_UNAVAILABLE } from "@/services/integrations/ai/school-intelligence-policy";

type CoursePredictionsPanelProps = {
  courseId: string;
  courseCode?: string;
};

export function CoursePredictionsPanel({
  courseId,
  courseCode: _courseCode,
}: CoursePredictionsPanelProps) {
  const [predictions, setPredictions] = useState<SchoolAssessmentPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Active proposal review
  const [review, setReview] = useState<AssessmentPredictionReview | null>(null);
  const [proposedList, setProposedList] = useState<ProposedPrediction[]>([]);

  useEffect(() => {
    let mounted = true;
    void getCoursePredictionsAction(courseId).then((res) => {
      if (mounted && res.ok && res.predictions) {
        setPredictions(res.predictions.filter((p) => p.status === "active"));
      }
    });
    return () => {
      mounted = false;
    };
  }, [courseId]);

  async function handlePredict() {
    setLoading(true);
    setError(null);
    const companionConfig = getCompanionSession();

    try {
      const result = await generateRoutedProposal(
        "assessment_prediction",
        courseId,
        companionConfig,
      );

      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }

      const rev = (result as { ok: true; review: AssessmentPredictionReview }).review;
      setReview(rev);
      setProposedList(rev.predictions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to predict assessments.");
    } finally {
      setLoading(false);
    }
  }

  function handleApplyProposed() {
    if (!review) return;
    startTransition(async () => {
      try {
        let batchId = review.batchId;
        const revised = await reviseAssessmentPredictionsAction(batchId, proposedList);
        batchId = revised.batchId;
        const res = await applyAssessmentPredictionsAction(batchId);
        if (res.ok) {
          setReview(null);
          setProposedList([]);
          const updated = await getCoursePredictionsAction(courseId);
          if (updated.ok && updated.predictions) {
            setPredictions(updated.predictions.filter((p) => p.status === "active"));
          }
        } else {
          setError("Failed to apply predictions.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply predictions.");
      }
    });
  }

  function handleDismiss(predictionId: string) {
    startTransition(async () => {
      const result = await dismissPredictionAction(predictionId);
      if (!result.ok) {
        setError("Prediction could not be dismissed. Refresh and try again.");
        return;
      }
      setError(null);
      setPredictions((prev) => prev.filter((p) => p.id !== predictionId));
    });
  }

  function handleConfirmTask(p: SchoolAssessmentPrediction) {
    startTransition(async () => {
      const result = await confirmPredictionAsTaskAction(p.id, {
        title: p.title,
        dueDate: p.predictedDate,
        dueAt: p.predictedTime ? `${p.predictedDate}T${p.predictedTime}:00Z` : undefined,
        courseId: p.courseId,
      });
      if (!result.ok) {
        setError(SCHOOL_INTELLIGENCE_UNAVAILABLE);
        return;
      }
      setError(null);
      setPredictions((prev) => prev.filter((item) => item.id !== p.id));
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles size={14} style={{ color: "var(--accent-text)" }} aria-hidden="true" />
          <h3 style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 750, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Assessment Intelligence
          </h3>
          <Badge variant="subtle" size="sm">
            {predictions.length}
          </Badge>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={loading || pending}
          onClick={handlePredict}
        >
          {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
          <span>{predictions.length > 0 ? "Recalculate" : "Predict Assessments"}</span>
        </Button>
      </div>

      {error ? (
        <div
          style={{
            padding: "0.6rem 0.8rem",
            borderRadius: "var(--radius-sm)",
            background: "color-mix(in oklch, var(--destructive) 15%, transparent)",
            color: "var(--destructive)",
            fontSize: "0.8125rem",
            fontWeight: 600,
          }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {/* Review New Proposed Predictions */}
      {review && proposedList.length > 0 ? (
        <Surface variant="base" style={{ padding: "1rem", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "0.75rem", border: "1px solid var(--accent-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>
              {proposedList.length} Proposed Assessment{proposedList.length === 1 ? "" : "s"}
            </span>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReview(null)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApplyProposed}
                disabled={pending}
              >
                {pending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                <span>Approve Predictions</span>
              </Button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {proposedList.map((p, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--surface-subtle)",
                  fontSize: "0.8125rem",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <strong>◇ Possible {p.title}</strong>
                  <span style={{ color: "var(--text-secondary)", marginLeft: "0.5rem" }}>{p.predictedDate}</span>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, marginLeft: "0.4rem", color: "var(--accent-text)" }}>
                    [{p.confidence}]
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setProposedList(proposedList.filter((_, i) => i !== idx))}
                  style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0.2rem" }}
                  aria-label="Remove prediction"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      {/* Active Predictions List */}
      {predictions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {predictions.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1rem",
                borderRadius: "var(--radius-md)",
                background: "var(--surface)",
                border: "1px dashed var(--border)",
                gap: "0.75rem",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary)" }}>
                    ◇ Possible {p.title}
                  </span>
                  <Badge variant={p.confidence === "HIGH" ? "subtle" : "outline"} size="sm">
                    {p.confidence}
                  </Badge>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  {p.predictedDate} {p.predictedTime ? `at ${p.predictedTime}` : ""} · {p.rationale}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  title="Confirm as native Task"
                  onClick={() => handleConfirmTask(p)}
                  disabled={pending}
                >
                  <Check size={13} aria-hidden="true" />
                  <span>Task</span>
                </Button>
                <button
                  type="button"
                  title="Dismiss prediction"
                  onClick={() => handleDismiss(p.id)}
                  disabled={pending}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    padding: "0.4rem",
                    cursor: "pointer",
                    borderRadius: "var(--radius-sm)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  aria-label={`Dismiss prediction ${p.title}`}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: "1rem 1.25rem",
            borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border-subtle)",
            background: "var(--surface-subtle)",
            color: "var(--text-secondary)",
            fontSize: "0.8125rem",
          }}
        >
          No predictions calculated. Click &quot;Predict Assessments&quot; to analyze syllabus rules and meetings.
        </div>
      )}
    </div>
  );
}
