"use client";

import {
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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
        const res = await applyAssessmentPredictionsAction({
          batchId: review.batchId,
          predictions: proposedList,
        });
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
    <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Sparkles size={14} color="var(--accent-text)" />
          <span style={{ fontSize: "0.78rem", fontWeight: 750, color: "var(--text-secondary)", textTransform: "uppercase" }}>
            Assessment Intelligence ({predictions.length})
          </span>
        </div>

        <button
          type="button"
          disabled={loading || pending}
          onClick={handlePredict}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            background: "transparent",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "0.25rem 0.55rem",
            fontSize: "0.75rem",
            fontWeight: 650,
            color: "var(--accent-text)",
            cursor: "pointer",
          }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {predictions.length > 0 ? "Recalculate" : "Predict Assessments"}
        </button>
      </div>

      {error ? (
        <div style={{ padding: "0.4rem 0.6rem", borderRadius: "var(--radius-sm)", background: "color-mix(in srgb, var(--destructive) 15%, transparent)", color: "var(--destructive)", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
          {error}
        </div>
      ) : null}

      {/* Review New Proposed Predictions */}
      {review && proposedList.length > 0 ? (
        <div style={{ padding: "0.75rem", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--accent-border, var(--border-strong))", marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)" }}>
              {proposedList.length} Proposed Assessment{proposedList.length === 1 ? "" : "s"}
            </span>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button"
                onClick={() => setReview(null)}
                disabled={pending}
                style={{ padding: "0.25rem 0.5rem", borderRadius: "var(--radius-sm)", background: "transparent", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)", fontSize: "0.72rem", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyProposed}
                disabled={pending}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.65rem", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "var(--accent-foreground)", border: "none", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
              >
                {pending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Approve Predictions
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {proposedList.map((p, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm)", background: "var(--surface-subtle)", fontSize: "0.78rem" }}>
                <div>
                  <strong>◇ Possible {p.title}</strong>
                  <span style={{ color: "var(--text-secondary)", marginLeft: "0.5rem" }}>{p.predictedDate}</span>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, marginLeft: "0.4rem", color: "var(--accent-text)" }}>[{p.confidence}]</span>
                </div>
                <button
                  type="button"
                  onClick={() => setProposedList(proposedList.filter((_, i) => i !== idx))}
                  style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
                  aria-label="Remove prediction"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Active Predictions List */}
      {predictions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {predictions.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.45rem 0.65rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-subtle)",
                border: "1px dashed var(--border-subtle)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)" }}>
                    ◇ Possible {p.title}
                  </span>
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      padding: "0.1rem 0.35rem",
                      borderRadius: "var(--radius-pill)",
                      background: p.confidence === "HIGH" ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--surface)",
                      color: "var(--accent-text)",
                    }}
                  >
                    {p.confidence}
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
                  {p.predictedDate} {p.predictedTime ? `at ${p.predictedTime}` : ""} · {p.rationale}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginLeft: "0.5rem" }}>
                <button
                  type="button"
                  title="Confirm as task"
                  onClick={() => handleConfirmTask(p)}
                  disabled={pending}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.2rem 0.4rem",
                    color: "var(--accent-text)",
                    fontSize: "0.72rem",
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  <Check size={12} /> Task
                </button>
                <button
                  type="button"
                  title="Dismiss prediction"
                  onClick={() => handleDismiss(p.id)}
                  disabled={pending}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    padding: "0.2rem",
                    cursor: "pointer",
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic" }}>
          No predictions calculated. Click &quot;Predict Assessments&quot; to analyze syllabus rules and meetings.
        </p>
      )}
    </div>
  );
}
