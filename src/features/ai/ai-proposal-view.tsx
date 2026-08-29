"use client";

import { CheckCircle2, Sparkles, XCircle } from "lucide-react";

import { Surface } from "@/components/ui/surface";
import type { ProposedAiAction } from "@/services/integrations/ai/action-contract";

import styles from "./ai-proposal-view.module.css";

type AiProposalViewProps = {
  batchId: string | null;
  actions: readonly ProposedAiAction[];
  onApply: () => void;
  onDismiss: () => void;
  pending?: boolean;
};

export function AiProposalView({
  batchId: _batchId,
  actions,
  onApply,
  onDismiss,
  pending = false,
}: AiProposalViewProps) {
  if (actions.length === 0) return null;

  return (
    <Surface variant="glass" className={styles.card}>
      <header className={styles.header}>
        <Sparkles size={20} color="var(--accent-text)" />
        <div>
          <h3>AI Proposed Actions ({actions.length})</h3>
          <p>Review the proposed changes before committing to your workspace.</p>
        </div>
      </header>

      <ul className={styles.actionList}>
        {actions.map((action, index) => {
          let title = action.type.replace(/_/g, " ").toUpperCase();
          let detail = "";

          if ("title" in action && action.title) {
            title = `${action.type.replace(/_/g, " ").toUpperCase()}: ${action.title}`;
          }
          if ("due_at" in action && action.due_at) {
            detail = `Due: ${new Date(action.due_at).toLocaleString()}`;
          }
          if ("starts_at" in action && action.starts_at) {
            detail = `Time: ${new Date(action.starts_at).toLocaleString()}`;
          }
          if (action.rationale) {
            detail = detail ? `${detail} · ${action.rationale}` : action.rationale;
          }

          return (
            <li key={index} className={styles.actionItem}>
              <div className={styles.actionTitle}>
                <CheckCircle2 size={16} color="#34d399" />
                <span>{title}</span>
              </div>
              {detail ? <div className={styles.actionMeta}>{detail}</div> : null}
            </li>
          );
        })}
      </ul>

      <footer className={styles.footer}>
        <button
          className={styles.dismissButton}
          type="button"
          disabled={pending}
          onClick={onDismiss}
        >
          <XCircle size={16} style={{ verticalAlign: "middle", marginRight: "0.25rem" }} />
          Dismiss
        </button>
        <button
          className={styles.applyButton}
          type="button"
          disabled={pending}
          onClick={onApply}
        >
          {pending ? "Applying..." : "Confirm & Apply"}
        </button>
      </footer>
    </Surface>
  );
}
