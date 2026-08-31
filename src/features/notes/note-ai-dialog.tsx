"use client";

import {
  Check,
  CheckSquare,
  Copy,
  FileEdit,
  FileText,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type {
  NoteSummaryProposal,
  NoteRewriteProposal,
  NoteActionItemsProposal,
  NoteActionItem,
} from "@/services/integrations/ai/note-intelligence-contract";
import {
  applyNoteRewriteAction,
  applyNoteActionItemsAction,
} from "./note-ai-actions";
import styles from "./note-ai-dialog.module.css";

type TabMode = "summary" | "rewrite" | "action_items";

type NoteAiDialogProps = {
  note: { id: string; title: string; body: string };
  initialTab?: TabMode;
  onClose: () => void;
  onNoteUpdated: (newBody: string) => void;
};

export function NoteAiDialog({
  note,
  initialTab = "summary",
  onClose,
  onNoteUpdated,
}: NoteAiDialogProps) {
  const [tab, setTab] = useState<TabMode>(initialTab);
  const controller = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(() => Boolean(note.body.trim()));
  const [error, setError] = useState<string | null>(() =>
    !note.body.trim() ? "This note is empty. Add some text first." : null,
  );
  const [applying, startApplyTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // Proposal results
  const [summaryResult, setSummaryResult] = useState<NoteSummaryProposal | null>(null);
  const [rewriteResult, setRewriteResult] = useState<NoteRewriteProposal | null>(null);
  const [rewriteBatchId, setRewriteBatchId] = useState<string | null>(null);
  const [actionItemsResult, setActionItemsResult] = useState<
    Array<NoteActionItem & { selected: boolean }>
  >([]);
  const [actionItemsBatchId, setActionItemsBatchId] = useState<string | null>(null);

  useEffect(() => {
    if (!note.body.trim()) return;

    let active = true;
    const abort = new AbortController();
    controller.current = abort;

    const companionConfig = getCompanionSession();
    const kind =
      tab === "summary"
        ? "note_summary"
        : tab === "rewrite"
        ? "note_rewrite"
        : "note_action_items";

    void generateRoutedProposal(kind, note.id, companionConfig, abort.signal)
      .then((result) => {
        if (!active || abort.signal.aborted) return;
        if (!result.ok) {
          setError(result.message);
          setLoading(false);
          return;
        }
        const rev = (result as { ok: true; review: { batchId: string; summary?: string; keyPoints?: string[]; rewrittenBody?: string; changesExplanation?: string; items?: NoteActionItem[]; proposal?: unknown } }).review;
        if (tab === "summary") {
          setSummaryResult({
            schema_version: 1,
            type: "propose_note_summary",
            source_handle: "",
            summary: rev.summary || (rev.proposal as NoteSummaryProposal)?.summary || "",
            keyPoints: rev.keyPoints || (rev.proposal as NoteSummaryProposal)?.keyPoints || [],
          });
        } else if (tab === "rewrite") {
          setRewriteBatchId(rev.batchId);
          setRewriteResult({
            schema_version: 1,
            type: "propose_note_rewrite",
            source_handle: "",
            rewrittenBody: rev.rewrittenBody || (rev.proposal as NoteRewriteProposal)?.rewrittenBody || "",
            changesExplanation: rev.changesExplanation || (rev.proposal as NoteRewriteProposal)?.changesExplanation || "Polished note structure",
          });
        } else if (tab === "action_items") {
          setActionItemsBatchId(rev.batchId);
          const items = rev.items || (rev.proposal as NoteActionItemsProposal)?.actionItems || [];
          setActionItemsResult(items.map((it) => ({ ...it, selected: true })));
        }
        setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to process note.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
      abort.abort();
    };
  }, [tab, note.id, note.body]);

  function handleTabSelect(nextTab: TabMode) {
    if (loading || applying || nextTab === tab) return;
    setError(null);
    setLoading(true);
    setTab(nextTab);
  }

  function handleInsertSummary() {
    if (!summaryResult) return;
    const bullets = summaryResult.keyPoints.map((p) => `- ${p}`).join("\n");
    const block = `## Summary\n${summaryResult.summary}\n\n### Key Points\n${bullets}\n\n---\n\n${note.body}`;
    onNoteUpdated(block);
    onClose();
  }

  function handleCopySummary() {
    if (!summaryResult) return;
    const text = `${summaryResult.summary}\n\nKey Points:\n${summaryResult.keyPoints.map((p) => `• ${p}`).join("\n")}`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleApplyRewrite(_mode: "replace" | "append") {
    if (!rewriteBatchId) return;
    startApplyTransition(async () => {
      const res = await applyNoteRewriteAction(rewriteBatchId, note.id);
      if (res.ok && res.newBody) {
        onNoteUpdated(res.newBody);
        onClose();
      } else {
        setError(res.message || "Failed to update note.");
      }
    });
  }

  function handleApplyActionItems() {
    if (!actionItemsBatchId) return;
    startApplyTransition(async () => {
      const res = await applyNoteActionItemsAction(actionItemsBatchId, note.id);
      if (res.ok) {
        onClose();
      } else {
        setError("Failed to create tasks.");
      }
    });
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !applying) onClose();
      }}
    >
      <div className={`${styles.modal} motion-enter`} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Notes AI Assistant</p>
            <h3 className={styles.title}>{note.title || "Untitled Note"}</h3>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={applying}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            className={styles.tab}
            data-active={tab === "summary"}
            onClick={() => handleTabSelect("summary")}
            disabled={loading || applying}
          >
            <FileText size={15} /> Summarize
          </button>
          <button
            type="button"
            className={styles.tab}
            data-active={tab === "rewrite"}
            onClick={() => handleTabSelect("rewrite")}
            disabled={loading || applying}
          >
            <FileEdit size={15} /> Clean Up & Organize
          </button>
          <button
            type="button"
            className={styles.tab}
            data-active={tab === "action_items"}
            onClick={() => handleTabSelect("action_items")}
            disabled={loading || applying}
          >
            <CheckSquare size={15} /> Extract Action Items
          </button>
        </div>

        <div className={styles.content}>
          {error ? (
            <div style={{ padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--destructive) 15%, transparent)", color: "var(--destructive)", fontSize: "0.82rem", fontWeight: 600 }}>
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className={styles.loadingBox}>
              <Loader2 size={36} className="animate-spin" style={{ color: "var(--accent-text)", marginBottom: "0.75rem" }} />
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--text-primary)" }}>
                {tab === "summary" && "Generating summary…"}
                {tab === "rewrite" && "Structuring & polishing note…"}
                {tab === "action_items" && "Extracting actionable tasks…"}
              </h4>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Processing note content with your chosen AI provider.
              </p>
            </div>
          ) : null}

          {/* Summary Tab View */}
          {!loading && tab === "summary" && summaryResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ padding: "1rem", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--border-subtle)" }}>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--accent-text)", textTransform: "uppercase" }}>
                  Executive Summary
                </h4>
                <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.6, color: "var(--text-primary)" }}>
                  {summaryResult.summary}
                </p>
              </div>

              {summaryResult.keyPoints.length > 0 ? (
                <div style={{ padding: "1rem", borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--border-subtle)" }}>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Key Bullet Points
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.88rem", color: "var(--text-primary)" }}>
                    {summaryResult.keyPoints.map((pt, idx) => (
                      <li key={idx}>{pt}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Rewrite Tab View */}
          {!loading && tab === "rewrite" && rewriteResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className={styles.explanationBanner}>
                <strong>AI Changes:</strong> {rewriteResult.changesExplanation}
              </div>

              <div className={styles.sideBySideGrid}>
                <div className={styles.diffColumn}>
                  <p className={styles.columnHeader}>Original Note</p>
                  <div className={styles.previewBody}>{note.body}</div>
                </div>

                <div className={styles.diffColumn} style={{ borderColor: "var(--accent-border, var(--border-strong))" }}>
                  <p className={styles.columnHeader} style={{ color: "var(--accent-text)" }}>Organized Preview</p>
                  <div className={styles.previewBody}>{rewriteResult.rewrittenBody}</div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Action Items Tab View */}
          {!loading && tab === "action_items" && actionItemsResult.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.85rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                Found {actionItemsResult.length} Action Items
              </h4>

              {actionItemsResult.map((item, idx) => (
                <div key={idx} className={styles.actionItemRow}>
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={(e) => {
                      const updated = [...actionItemsResult];
                      updated[idx] = { ...updated[idx], selected: e.target.checked };
                      setActionItemsResult(updated);
                    }}
                    style={{ width: "1.15rem", height: "1.15rem", accentColor: "var(--accent)" }}
                  />
                  <input
                    value={item.title}
                    onChange={(e) => {
                      const updated = [...actionItemsResult];
                      updated[idx] = { ...updated[idx], title: e.target.value };
                      setActionItemsResult(updated);
                    }}
                    style={{
                      flex: 1,
                      padding: "0.35rem 0.5rem",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-subtle)",
                      color: "var(--text-primary)",
                      fontSize: "0.85rem",
                    }}
                  />
                  {item.dueDate ? (
                    <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {item.dueDate}
                    </span>
                  ) : null}
                  <span className={styles.priorityBadge}>{item.priority || "medium"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className={styles.footer}>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface)",
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
              fontWeight: 650,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>

          <div style={{ display: "flex", gap: "0.6rem" }}>
            {tab === "summary" && summaryResult ? (
              <>
                <button
                  type="button"
                  onClick={handleCopySummary}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.5rem 1rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface)",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy Summary"}
                </button>
                <button
                  type="button"
                  onClick={handleInsertSummary}
                  disabled={applying}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.5rem 1.25rem",
                    borderRadius: "var(--radius-md)",
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                    border: "none",
                    fontSize: "0.85rem",
                    fontWeight: 750,
                    cursor: "pointer",
                  }}
                >
                  <Sparkles size={14} /> Insert at Top of Note
                </button>
              </>
            ) : null}

            {tab === "rewrite" && rewriteResult ? (
              <>
                <button
                  type="button"
                  onClick={() => handleApplyRewrite("append")}
                  disabled={applying}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface)",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  Insert at Bottom
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyRewrite("replace")}
                  disabled={applying}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.5rem 1.25rem",
                    borderRadius: "var(--radius-md)",
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                    border: "none",
                    fontSize: "0.85rem",
                    fontWeight: 750,
                    cursor: "pointer",
                  }}
                >
                  <Check size={14} /> Replace Note Content
                </button>
              </>
            ) : null}

            {tab === "action_items" && actionItemsResult.length > 0 ? (
              <button
                type="button"
                onClick={handleApplyActionItems}
                disabled={applying || actionItemsResult.filter((it) => it.selected).length === 0}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.5rem 1.25rem",
                  borderRadius: "var(--radius-md)",
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                  border: "none",
                  fontSize: "0.85rem",
                  fontWeight: 750,
                  cursor: "pointer",
                }}
              >
                <Check size={14} />
                Create {actionItemsResult.filter((it) => it.selected).length} Tasks
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
