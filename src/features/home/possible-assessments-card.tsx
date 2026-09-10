"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
      variant="subtle"
      className={`${styles.predictionBanner} motion-enter`}
      data-dashboard-widget="possible_assessments"
    >
      <div className={styles.predictionHeader}>
        <div className={styles.predictionTitleGroup}>
          <Sparkles size={16} className={styles.predictionIcon} aria-hidden="true" />
          <h4 className={styles.predictionHeading}>School Pulse · Possible Assessment</h4>
        </div>
        <Badge
          tone={topPrediction.confidence === "HIGH" ? "accent" : "neutral"}
          size="sm"
        >
          {topPrediction.confidence} CONFIDENCE
        </Badge>
      </div>

      <div className={styles.predictionBody}>
        {error ? <p role="alert" className={styles.predictionError}>{error}</p> : null}
        <div className={styles.predictionItemRow}>
          {topPrediction.courseCode ? (
            <strong className={styles.predictionCourseCode}>
              {topPrediction.courseCode}
            </strong>
          ) : null}
          <span className={styles.predictionItemTitle}>
            ◇ Possible {topPrediction.title}
          </span>
        </div>

        <p className={styles.predictionEstimate}>
          Estimated: <strong>{topPrediction.predictedDate}</strong>
          {topPrediction.predictedTime ? ` at ${topPrediction.predictedTime}` : ""}
        </p>

        {topPrediction.rationale ? (
          <p className={styles.predictionRationale}>
            &ldquo;{topPrediction.rationale}&rdquo;
          </p>
        ) : null}

        <div className={styles.predictionActions}>
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            icon={<Check size={14} />}
            onClick={() => handleConfirm(topPrediction)}
          >
            Confirm as Task
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            icon={<X size={14} />}
            onClick={() => handleDismiss(topPrediction.id)}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </Surface>
  );
}
