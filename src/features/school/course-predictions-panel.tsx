"use client";

import { useEffect, useState, useTransition } from "react";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type { SchoolAssessmentPrediction } from "@/services/school/prediction-service";
import type { AssessmentPredictionReview, ProposedPrediction } from "@/services/integrations/ai/assessment-prediction-contract";
import { getCoursePredictionsAction, dismissPredictionAction, reviseAssessmentPredictionsAction,
  applyAssessmentPredictionsAction, rejectAssessmentPredictionsAction } from "./prediction-actions";
import { PredictionConversion } from "./prediction-conversion";
import styles from "./course-predictions-panel.module.css";

type Props = { courseId: string; courseCode?: string; syllabuses: { id: string; title: string }[] };

export function CoursePredictionsPanel({ courseId, courseCode, syllabuses }: Props) {
  const [predictions, setPredictions] = useState<SchoolAssessmentPrediction[]>([]);
  const [syllabusId, setSyllabusId] = useState("");
  const [review, setReview] = useState<AssessmentPredictionReview | null>(null);
  const [draft, setDraft] = useState<ProposedPrediction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = review !== null && JSON.stringify(draft) !== JSON.stringify(review.predictions);

  useEffect(() => {
    let mounted = true;
    // Persisted reads only. Inference requires the explicit button below.
    void getCoursePredictionsAction(courseId).then(result => {
      if (mounted && result.ok && result.predictions) setPredictions(result.predictions.filter(p => p.status === "active"));
    });
    return () => { mounted = false; };
  }, [courseId]);

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      setError(null);
      try { await action(); } catch { setError("Request unavailable or sources changed. Review the saved Course and syllabus, then recalculate. Nothing was approved."); }
    });
  }
  function generate() {
    run(async () => {
      const result = await generateRoutedProposal("assessment_prediction", { courseId, syllabusMaterialId: syllabusId }, getCompanionSession());
      if (!result.ok) { setError(result.message); return; }
      const next = result.review as AssessmentPredictionReview;
      setReview(next); setDraft(next.predictions);
    });
  }
  function revise() {
    if (!review) return;
    run(async () => {
      const next = await reviseAssessmentPredictionsAction(review.batchId, draft);
      setReview(next); setDraft(next.predictions);
      // Separate click required to approve the newly persisted successor.
    });
  }
  function approve() {
    if (!review || dirty) return;
    run(async () => {
      await applyAssessmentPredictionsAction(review.batchId);
      setReview(null); setDraft([]);
      const result = await getCoursePredictionsAction(courseId);
      if (result.ok && result.predictions) setPredictions(result.predictions.filter(p => p.status === "active"));
    });
  }
  function edit(index: number, patch: Partial<ProposedPrediction>) {
    setDraft(items => items.map((item, at) => at === index ? { ...item, ...patch } : item));
  }

  return <section className={styles.panel} aria-label={`Possible assessments for ${courseCode ?? "Course"}`}>
    <h3>Possible assessments</h3>
    <p>Use one saved syllabus and this Course’s meetings. Local AI only; cloud fallback is disabled. Generating predictions creates no Tasks or Calendar events. Each conversion needs a separate review and approval.</p>
    {!review && <div className={styles.actions}>
      <label>Syllabus
        <Select
          value={syllabusId}
          onChange={setSyllabusId}
          disabled={pending}
          options={[
            { value: "", label: "Select a saved syllabus" },
            ...syllabuses.map((syllabus) => ({ value: syllabus.id, label: syllabus.title })),
          ]}
        />
      </label>
      <button type="button" disabled={pending || !syllabusId} onClick={generate}>Recalculate predictions</button>
    </div>}
    {syllabuses.length === 0 && <p>Add a Course Material of type Syllabus with its text in the description first.</p>}
    {error && <p role="alert">{error}</p>}
    {review && <div className={styles.review}>
      <h4>Review {draft.length} proposed assessments</h4>
      <p>Approval replaces previously generated active predictions for this Course. Review expires {new Date(review.expiresAt).toLocaleTimeString()}.</p>
      {draft.length === 0 && <p>No supported assessments proposed. You may approve an empty recalculation to retire older predictions, or cancel.</p>}
      {draft.map((p, index) => <fieldset key={index} disabled={pending}>
        <legend>Possible assessment {index + 1} · {p.confidence}</legend>
        <label>Title<input value={p.title} maxLength={200} onChange={e => edit(index, { title: e.target.value })} /></label>
        <label>Date<DatePicker value={p.predictedDate} onChange={value => edit(index, { predictedDate: value })} /></label>
        {p.predictedTime && <p>Time: {p.predictedTime} (local)</p>}
        <p>{p.rationale}</p>
        <p>Evidence: {p.sourceReferences.map(ref => ref.endsWith("_syllabus") ? "selected syllabus" : "Course meetings").join(", ")}</p>
        <button type="button" onClick={() => setDraft(items => items.filter((_, at) => at !== index))}>Remove assessment {index + 1}</button>
      </fieldset>)}
      <div className={styles.actions}>
        <button type="button" disabled={pending} onClick={() => run(async () => {
          await rejectAssessmentPredictionsAction(review.batchId); setReview(null); setDraft([]);
        })}>Cancel review</button>
        {dirty
          ? <button type="button" disabled={pending} onClick={revise}>Save edits for review</button>
          : <button type="button" disabled={pending} onClick={approve}>Approve persisted predictions</button>}
      </div>
      {dirty && <p>Save edits first. The new persisted review requires separate approval.</p>}
    </div>}
    <ul className={styles.list}>
      {predictions.map(p => <li key={p.id}>
        <strong>Possible {p.title} · {p.confidence}</strong>
        <p>{p.predictedDate}{p.predictedTime ? ` at ${p.predictedTime}` : ""} · {p.rationale}</p>
        {p.stale && <p>Sources changed — stale prediction. Recalculate explicitly to review a replacement.</p>}
        <PredictionConversion predictionId={p.id} disabled={pending||Boolean(p.stale)} onConverted={()=>setPredictions(items=>items.filter(x=>x.id!==p.id))}/>
        <button type="button" disabled={pending} onClick={() => run(async () => {
          const result = await dismissPredictionAction(p.id);
          if (!result.ok) throw new Error("dismissal unavailable");
          setPredictions(items => items.filter(item => item.id !== p.id));
        })}>Dismiss {p.title}</button>
      </li>)}
    </ul>
    {pending && <p role="status">Working…</p>}
  </section>;
}
