"use client";

import { Check, Inbox, Loader2, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import { createCaptureAction } from "@/features/capture/capture-actions";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type {
  QuickCaptureProposal,
  ProposedTaskCapture,
  ProposedEventCapture,
} from "@/services/integrations/ai/quick-capture-contract";
import {
  applyQuickCaptureAction,
} from "@/features/capture/quick-capture-actions";

import styles from "./capture.module.css";

export function CaptureComposer({
  compact = false,
  onCaptured,
}: {
  compact?: boolean;
  onCaptured?: () => void;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [aiParsing, setAiParsing] = useState(false);
  const [aiProposal, setAiProposal] = useState<QuickCaptureProposal | null>(null);
  const [aiBatchId, setAiBatchId] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("capture") ?? "");
    if (!text.trim()) {
      setMessage("Write something to capture first.");
      textareaRef.current?.focus();
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await createCaptureAction(text);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      form.reset();
      setAiProposal(null);
      setAiBatchId(null);
      onCaptured?.();
    });
  }

  async function handleAiParse() {
    const text = textareaRef.current?.value.trim();
    if (!text) {
      setMessage("Write something to parse first.");
      textareaRef.current?.focus();
      return;
    }

    setAiParsing(true);
    setMessage(null);
    const companionConfig = getCompanionSession();

    try {
      const result = await generateRoutedProposal(
        "quick_capture",
        text,
        companionConfig,
      );

      if (!result.ok) {
        setMessage(result.message);
        setAiParsing(false);
        return;
      }

      const rev = (result as { ok: true; review: { batchId: string; proposal: QuickCaptureProposal } }).review;
      setAiBatchId(rev.batchId);
      setAiProposal(rev.proposal);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to parse with AI.");
    } finally {
      setAiParsing(false);
    }
  }

  function handleCreateFromProposal() {
    if (!aiProposal || !aiBatchId) return;
    startTransition(async () => {
      const res = await applyQuickCaptureAction(aiBatchId);
      if (res.ok) {
        if (textareaRef.current) textareaRef.current.value = "";
        setAiProposal(null);
        setAiBatchId(null);
        setMessage(aiProposal.captured.entityType === "task" ? "Task created successfully." : "Calendar event created successfully.");
        router.refresh();
        onCaptured?.();
      } else {
        setMessage("Failed to create item.");
      }
    });
  }

  const form = (
    <form className={styles.composerForm} onSubmit={submit} noValidate>
      <label className={styles.captureField}>
        <span>Capture raw text</span>
        <textarea
          ref={textareaRef}
          name="capture"
          rows={compact ? 5 : 4}
          maxLength={10000}
          placeholder="Drop a thought, reminder, or pasted text here… (e.g. 'Submit Physics lab report by Friday 5pm')"
          disabled={pending || aiParsing}
          aria-describedby={message ? "capture-message" : "capture-help"}
        />
      </label>

      {/* AI Parsed Proposal Preview Card */}
      {aiProposal ? (
        <div
          style={{
            padding: "0.85rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--accent-border, var(--border-strong))",
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Sparkles size={14} color="var(--accent-text)" />
              <strong style={{ fontSize: "0.82rem", color: "var(--accent-text)", textTransform: "uppercase" }}>
                Parsed as {aiProposal.captured.entityType === "task" ? "Task" : "Calendar Event"}
              </strong>
            </div>
            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-secondary)" }}>
              [{aiProposal.confidence} CONFIDENCE]
            </span>
          </div>

          <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {aiProposal.captured.title}
          </div>

          {aiProposal.captured.entityType === "task" ? (
            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "flex", gap: "0.6rem" }}>
              {(aiProposal.captured as ProposedTaskCapture).dueDate ? (
                <span>Due: {(aiProposal.captured as ProposedTaskCapture).dueDate} {(aiProposal.captured as ProposedTaskCapture).dueTime || ""}</span>
              ) : null}
              <span>Priority: {(aiProposal.captured as ProposedTaskCapture).priority || "medium"}</span>
              {(aiProposal.captured as ProposedTaskCapture).courseCode ? (
                <span>Course: {(aiProposal.captured as ProposedTaskCapture).courseCode}</span>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "flex", gap: "0.6rem" }}>
              <span>
                Date: {(aiProposal.captured as ProposedEventCapture).startDate}
                {(aiProposal.captured as ProposedEventCapture).startTime ? ` ${(aiProposal.captured as ProposedEventCapture).startTime}–${(aiProposal.captured as ProposedEventCapture).endTime || ""}` : " (All Day)"}
              </span>
              {(aiProposal.captured as ProposedEventCapture).location ? (
                <span>Location: {(aiProposal.captured as ProposedEventCapture).location}</span>
              ) : null}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
            <button
              type="button"
              className="motion-tactile"
              disabled={pending}
              onClick={handleCreateFromProposal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--accent)",
                color: "var(--accent-foreground)",
                border: "none",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Check size={13} /> Create {aiProposal.captured.entityType === "task" ? "Task" : "Event"}
            </button>
            <button
              type="button"
              className="motion-tactile"
              disabled={pending}
              onClick={() => setAiProposal(null)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.35rem 0.65rem",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.78rem",
                cursor: "pointer",
              }}
            >
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.composerFooter}>
        <p id={message ? "capture-message" : "capture-help"} role={message ? "alert" : undefined}>
          {message ?? "Saved as immutable evidence. You decide what it becomes next."}
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className={`${styles.secondaryButton} motion-interactive`}
            type="button"
            onClick={handleAiParse}
            disabled={pending || aiParsing}
          >
            {aiParsing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {aiParsing ? "Parsing…" : "Parse with AI"}
          </button>
          <button className={`${styles.primaryButton} motion-interactive`} type="submit" disabled={pending || aiParsing}>
            <Send size={17} aria-hidden="true" />
            {pending ? "Saving…" : "Send to Inbox"}
          </button>
        </div>
      </div>
    </form>
  );

  if (compact) return form;

  return (
    <Surface variant="glass" className={styles.composerCard}>
      <div className={styles.composerHeading}>
        <span aria-hidden="true"><Inbox size={19} /></span>
        <div>
          <h2>Universal capture</h2>
          <p>Text first. Interpretation happens only when you ask.</p>
        </div>
      </div>
      {form}
    </Surface>
  );
}

