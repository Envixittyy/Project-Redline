"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Surface } from "@/components/ui/surface";
import type { SchoolAssessmentPrediction } from "@/services/school/prediction-service";
import {
  getActivePredictionsAction,
  dismissPredictionAction,
  confirmPredictionAsTaskAction,
} from "@/features/school/prediction-actions";
import styles from "./home-dashboard.module.css";
import { SCHOOL_INTELLIGENCE_UNAVAILABLE } from "@/services/integrations/ai/school-intelligence-policy";

export function PossibleAssessmentsCard() {
  const [predictions, setPredictions] = useState<SchoolAssessmentPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getActivePredictionsAction().then((res) => {
      if (mounted && res.ok && res.predictions) {
        setPredictions(res.predictions.filter((p) => p.confidence === "HIGH" || p.confidence === "MEDIUM"));
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || predictions.length === 0) return null;

  const topPrediction = predictions[0];

  function handleDismiss(id: string) {
    startTransition(async () => {
      const result = await dismissPredictionAction(id);
      if (!result.ok) {
        setError("Prediction could not be dismissed. Refresh and try again.");
        return;
      }
      setError(null);
      setPredictions((prev) => prev.filter((p) => p.id !== id));
    });
  }

  function handleConfirm(pred: SchoolAssessmentPrediction) {
    startTransition(async () => {
      const result = await confirmPredictionAsTaskAction(pred.id, {
        title: pred.title,
        dueDate: pred.predictedDate,
        dueAt: pred.predictedTime ? `${pred.predictedDate}T${pred.predictedTime}:00Z` : undefined,
        courseId: pred.courseId,
      });
      if (!result.ok) {
        setError(SCHOOL_INTELLIGENCE_UNAVAILABLE);
        return;
      }
      setError(null);
      setPredictions((prev) => prev.filter((p) => p.id !== pred.id));
    });
  }

  return (
    <Surface
      variant="glass"
      className={`${styles.card} motion-enter`}
      data-dashboard-widget="possible_assessments"
      style={{
        border: "1px dashed var(--accent-border, var(--border-strong))",
        background: "var(--surface-subtle)",
      }}
    >
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles size={16} color="var(--accent-text)" />
          <h3>School Pulse · Possible Assessment</h3>
        </div>
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 750,
            padding: "0.2rem 0.5rem",
            borderRadius: "var(--radius-pill)",
            background: topPrediction.confidence === "HIGH" ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--surface)",
            color: "var(--accent-text)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {topPrediction.confidence} CONFIDENCE
        </span>
      </div>

      <div style={{ padding: "0.25rem 0", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {error ? <p role="alert">{error}</p> : null}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          {topPrediction.courseCode ? (
            <strong style={{ color: "var(--accent-text)", fontSize: "0.95rem" }}>
              {topPrediction.courseCode}
            </strong>
          ) : null}
          <span style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--text-primary)" }}>
            ◇ Possible {topPrediction.title}
          </span>
        </div>

        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          Estimated: <strong>{topPrediction.predictedDate}</strong>
          {topPrediction.predictedTime ? ` at ${topPrediction.predictedTime}` : ""}
        </p>

        <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic" }}>
          &ldquo;{topPrediction.rationale}&rdquo;
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
          <button
            type="button"
            className="motion-tactile"
            disabled={pending}
            onClick={() => handleConfirm(topPrediction)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.35rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              border: "1px solid var(--accent-border, transparent)",
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Check size={13} /> Confirm as Task
          </button>

          <button
            type="button"
            className="motion-tactile"
            disabled={pending}
            onClick={() => handleDismiss(topPrediction.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.35rem 0.65rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <X size={13} /> Dismiss
          </button>
        </div>
      </div>
    </Surface>
  );
}
