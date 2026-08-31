"use client";
import { Activity, Cpu, Flame, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalFrame } from "@/components/ui/modal-frame";
import { checkCompanionHealth } from "@/services/integrations/ai/companion-client";
import { evaluateHowCookedAmI } from "./hidden-commands";
import { readWorkloadAction } from "./personality-actions";
import styles from "./telemetry-modal.module.css";

function useWorkload() {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof readWorkloadAction>
  > | null>(null);
  useEffect(() => {
    let active = true;
    readWorkloadAction()
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active)
          setResult({
            ok: false,
            message: "Workload data unavailable. No assessment calculated.",
          });
      });
    return () => {
      active = false;
    };
  }, []);
  return result;
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricLabel}>{label}</span>
      <div className={styles.metricValue}>{value}</div>
    </div>
  );
}
function Close({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className={styles.closeButton}
      onClick={onClose}
      aria-label="Close dialog"
    >
      <X size={16} />
    </button>
  );
}
export function TelemetryModal({ onClose }: { onClose: () => void }) {
  const result = useWorkload();
  const [companionStatus, setCompanionStatus] = useState("Not checked");
  async function checkLocal() {
    setCompanionStatus("Checking…");
    const health = await checkCompanionHealth();
    setCompanionStatus(health.ok ? "Daemon reachable" : "Unavailable");
  }
  return (
    <ModalFrame
      label="Redline Telemetry"
      className={`${styles.panel} motion-enter`}
      onClose={onClose}
    >
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Activity size={16} />
          Redline Telemetry
        </div>
        <Close onClose={onClose} />
      </div>
      <div className={styles.grid}>
        <Metric label="Application" value="UI active" />
        <Metric
          label="Database read"
          value={
            !result ? "Checking…" : result.ok ? "Succeeded" : "Unavailable"
          }
        />
        <Metric label="Sync pipeline" value="Not checked" />
        <Metric label="Local companion" value={companionStatus} />
        <Metric
          label="Open tasks"
          value={result?.ok ? result.workload.remainingTasks : "—"}
        />
        <Metric
          label="Classes today"
          value={result?.ok ? result.workload.classesToday : "—"}
        />
      </div>
      <button
        type="button"
        className={styles.checkButton}
        onClick={checkLocal}
        disabled={companionStatus === "Checking…"}
      >
        <Cpu size={16} /> Check companion on this PC
      </button>
      <p className={styles.assessmentText}>
        Checks only daemon reachability, not model readiness. Your browser may
        request local network access. No external analytics are sent by this
        panel.
      </p>
      <p role="status">
        {result?.ok
          ? `Workload snapshot: ${new Date(result.measuredAt).toLocaleString()}`
          : (result?.message ?? "Reading workload…")}
      </p>
    </ModalFrame>
  );
}
export function HowCookedAmIModal({ onClose }: { onClose: () => void }) {
  const result = useWorkload();
  const assessment = result?.ok ? evaluateHowCookedAmI(result.workload) : null;
  return (
    <ModalFrame
      label="Workload Assessment"
      className={`${styles.panel} motion-enter`}
      onClose={onClose}
    >
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Flame size={16} />
          Workload Assessment
        </div>
        <Close onClose={onClose} />
      </div>
      {assessment ? (
        <>
          <div className={styles.grid}>
            <Metric label="Classes today" value={assessment.classesToday} />
            <Metric label="Remaining tasks" value={assessment.remainingTasks} />
            <Metric label="Due today" value={assessment.dueToday} />
            <Metric label="Overdue" value={assessment.overdue} />
          </div>
          <div className={styles.assessmentBox}>
            <span className={styles.assessmentLabel}>
              Workload: {assessment.level}
            </span>
            <p className={styles.assessmentText}>{assessment.assessment}</p>
          </div>
          <p>
            Open tasks include subtasks. Due today and overdue can overlap for
            elapsed timed deadlines. This measures workload only.
          </p>
        </>
      ) : (
        <p role="status">
          {result && !result.ok ? result.message : "Reading workload…"}
        </p>
      )}
    </ModalFrame>
  );
}
export function LosSantosModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame
      label="Los Santos"
      className={`${styles.panel} motion-enter`}
      onClose={onClose}
    >
      <div className={styles.header}>
        <div className={styles.headerTitle}>Los Santos</div>
        <Close onClose={onClose} />
      </div>
      <div className={styles.assessmentBox}>
        <p className={styles.assessmentText}>
          Los Santos: questionable decisions remain statistically likely.
        </p>
      </div>
    </ModalFrame>
  );
}
