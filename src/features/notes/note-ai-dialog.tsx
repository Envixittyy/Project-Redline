"use client";

import {
  Check,
  Copy,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Modal } from "@/components/ui/modal-frame";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type {
  NoteSummaryProposal,
  NoteRewriteProposal,
  NoteActionItemsProposal,
  NoteActionItem,
} from "@/services/integrations/ai/note-intelligence-contract";

import {
  applyNoteSummaryAction,
  applyNoteRewriteAction,
  applyNoteActionItemsAction,
  reviseNoteAction,
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
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [applying, startApplyTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  // Proposal results
  const [summaryResult, setSummaryResult] = useState<NoteSummaryProposal | null>(null);
  const [summaryBatchId, setSummaryBatchId] = useState<string | null>(null);
  const [rewriteResult, setRewriteResult] = useState<NoteRewriteProposal | null>(null);
  const [rewriteBatchId, setRewriteBatchId] = useState<string | null>(null);
  const [actionItemsResult, setActionItemsResult] = useState<
    Array<NoteActionItem & { selected: boolean }>
  >([]);
  const [actionItemsProposal, setActionItemsProposal] =
    useState<NoteActionItemsProposal | null>(null);
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
        const rev = (result as {
          ok: true;
          review: {
            batchId: string;
            summary?: string;
            keyPoints?: string[];
            rewrittenBody?: string;
            changesExplanation?: string;
            items?: NoteActionItem[];
            proposal?: unknown;
          };
        }).review;

        if (tab === "summary") {
          setSummaryBatchId(rev.batchId);
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
            rewrittenBody:
              rev.rewrittenBody ||
              (rev.proposal as NoteRewriteProposal)?.rewrittenBody ||
              "",
            changesExplanation:
              rev.changesExplanation ||
              (rev.proposal as NoteRewriteProposal)?.changesExplanation ||
              "Polished note structure",
          });
        } else if (tab === "action_items") {
          setActionItemsBatchId(rev.batchId);
          const proposal = rev.proposal as NoteActionItemsProposal;
          const items = rev.items || proposal?.actionItems || [];
          setActionItemsProposal(proposal);
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
    setReviewNotice(null);
    setLoading(true);
    setTab(nextTab);
  }

  function handleInsertSummary() {
    if (!summaryBatchId) return;
    startApplyTransition(async () => {
      const res = await applyNoteSummaryAction(summaryBatchId);
      if (res.ok && res.newBody) {
        onNoteUpdated(res.newBody);
        onClose();
      } else {
        setError("Failed to update note.");
      }
    });
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
        setError("Failed to update note.");
      }
    });
  }

  function handleApplyActionItems() {
    if (!actionItemsBatchId || !actionItemsProposal) return;
    startApplyTransition(async () => {
      const editedProposal: NoteActionItemsProposal = {
        ...actionItemsProposal,
        actionItems: actionItemsResult
          .filter((item) => item.selected)
          .map(({ selected: _selected, ...item }) => item),
      };
      if (
        JSON.stringify(editedProposal.actionItems) !==
        JSON.stringify(actionItemsProposal.actionItems)
      ) {
        const revised = await reviseNoteAction(
          actionItemsBatchId,
          "note_action_items",
          editedProposal,
        );
        setActionItemsBatchId(revised.batchId);
        setActionItemsProposal(revised.proposal as NoteActionItemsProposal);
        setActionItemsResult(
          (revised.proposal as NoteActionItemsProposal).actionItems.map((item) => ({
            ...item,
            selected: true,
          })),
        );
        setReviewNotice("Edits saved as a new proposal. Review once more, then approve task creation.");
        return;
      }
      const res = await applyNoteActionItemsAction(actionItemsBatchId, note.id);
      if (res.ok) {
        onClose();
      } else {
        setError("Failed to create tasks.");
      }
    });
  }

  const actionItemsDirty = Boolean(
    actionItemsProposal &&
      JSON.stringify(
        actionItemsResult
          .filter((item) => item.selected)
          .map(({ selected: _selected, ...item }) => item),
      ) !== JSON.stringify(actionItemsProposal.actionItems),
  );

  return (
    <Modal
      isOpen
      onClose={applying ? () => {} : onClose}
      title={note.title || "Untitled Note"}
      description="Notes AI Assistant"
      size="lg"
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: "0.5rem" }}>
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            Cancel
          </Button>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {tab === "summary" && summaryResult ? (
              <>
                <Button
                  variant="secondary"
                  icon={copied ? <Check size={14} /> : <Copy size={14} />}
                  onClick={handleCopySummary}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="primary"
                  icon={<Sparkles size={14} />}
                  onClick={handleInsertSummary}
                  disabled={applying}
                >
                  Insert at Top
                </Button>
              </>
            ) : null}

            {tab === "rewrite" && rewriteResult ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => handleApplyRewrite("append")}
                  disabled={applying}
                >
                  Insert at Bottom
                </Button>
                <Button
                  variant="primary"
                  icon={<Check size={14} />}
                  onClick={() => handleApplyRewrite("replace")}
                  disabled={applying}
                >
                  Replace Content
                </Button>
              </>
            ) : null}

            {tab === "action_items" && actionItemsResult.length > 0 ? (
              <Button
                variant="primary"
                icon={<Check size={14} />}
                onClick={handleApplyActionItems}
                disabled={applying || actionItemsResult.filter((it) => it.selected).length === 0}
              >
                {actionItemsDirty
                  ? "Save Edits for Review"
                  : `Create ${actionItemsResult.filter((it) => it.selected).length} Tasks`}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <SegmentedControl
          value={tab}
          onChange={(val) => handleTabSelect(val as TabMode)}
          options={[
            { value: "summary", label: "Summarize", disabled: loading || applying },
            { value: "rewrite", label: "Clean & Organize", disabled: loading || applying },
            { value: "action_items", label: "Action Items", disabled: loading || applying },
          ]}
        />

        {error ? (
          <Callout variant="error" role="alert">
            {error}
          </Callout>
        ) : null}

        {reviewNotice ? (
          <Callout variant="info">{reviewNotice}</Callout>
        ) : null}

        {loading ? (
          <div className={styles.loadingBox}>
            <Loader2
              size={32}
              className="animate-spin"
              style={{ color: "var(--accent-text)", marginBottom: "0.5rem" }}
            />
            <h4 style={{ margin: 0, fontSize: "0.9375rem", color: "var(--text-primary)" }}>
              {tab === "summary" && "Generating summary…"}
              {tab === "rewrite" && "Structuring & polishing note…"}
              {tab === "action_items" && "Extracting actionable tasks…"}
            </h4>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
              Processing note content with your chosen AI provider.
            </p>
          </div>
        ) : null}

        {/* Summary Tab */}
        {!loading && tab === "summary" && summaryResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "var(--radius-md)",
                background: "var(--surface)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <h4
                style={{
                  margin: "0 0 0.35rem",
                  fontSize: "0.8125rem",
                  color: "var(--accent-text)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Executive Summary
              </h4>
              <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.6, color: "var(--text-primary)" }}>
                {summaryResult.summary}
              </p>
            </div>

            {summaryResult.keyPoints.length > 0 ? (
              <div
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "var(--radius-md)",
                  background: "var(--surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <h4
                  style={{
                    margin: "0 0 0.35rem",
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Key Points
                </h4>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: "1.2rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.3rem",
                    fontSize: "0.875rem",
                    color: "var(--text-primary)",
                  }}
                >
                  {summaryResult.keyPoints.map((pt, idx) => (
                    <li key={idx}>{pt}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Rewrite Tab */}
        {!loading && tab === "rewrite" && rewriteResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <Callout variant="info" title="AI Changes">
              {rewriteResult.changesExplanation}
            </Callout>

            <div className={styles.sideBySideGrid}>
              <div className={styles.diffColumn}>
                <p className={styles.columnHeader}>Original Note</p>
                <div className={styles.previewBody}>{note.body}</div>
              </div>

              <div
                className={styles.diffColumn}
                style={{ borderColor: "var(--accent-border)" }}
              >
                <p className={styles.columnHeader} style={{ color: "var(--accent-text)" }}>
                  Organized Preview
                </p>
                <div className={styles.previewBody}>{rewriteResult.rewrittenBody}</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Action Items Tab */}
        {!loading && tab === "action_items" && actionItemsResult.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <h4
              style={{
                margin: "0 0 0.25rem",
                fontSize: "0.8125rem",
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
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
                  style={{ width: "1.1rem", height: "1.1rem", accentColor: "var(--accent)" }}
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
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {item.dueDate}
                  </span>
                ) : null}
                <Badge
                  tone={
                    item.priority === "high"
                      ? "destructive"
                      : item.priority === "low"
                      ? "neutral"
                      : "warning"
                  }
                  size="sm"
                >
                  {item.priority || "medium"}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
