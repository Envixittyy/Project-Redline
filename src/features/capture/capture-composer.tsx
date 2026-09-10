"use client";

import { Check, Inbox, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
        <div className={styles.proposalCard}>
          <div className={styles.proposalHeader}>
            <Badge
              tone="accent"
              size="sm"
              icon={<Sparkles size={13} />}
            >
              Parsed as {aiProposal.captured.entityType === "task" ? "Task" : "Calendar Event"}
            </Badge>
            <Badge tone="neutral" size="sm">
              {aiProposal.confidence.toUpperCase()} CONFIDENCE
            </Badge>
          </div>

          <div className={styles.proposalTitle}>
            {aiProposal.captured.title}
          </div>

          {aiProposal.captured.entityType === "task" ? (
            <div className={styles.proposalMeta}>
              {(aiProposal.captured as ProposedTaskCapture).dueDate ? (
                <span>
                  Due: {(aiProposal.captured as ProposedTaskCapture).dueDate}{" "}
                  {(aiProposal.captured as ProposedTaskCapture).dueTime || ""}
                </span>
              ) : null}
              <span>
                Priority: {(aiProposal.captured as ProposedTaskCapture).priority || "medium"}
              </span>
              {(aiProposal.captured as ProposedTaskCapture).courseCode ? (
                <span>
                  Course: {(aiProposal.captured as ProposedTaskCapture).courseCode}
                </span>
              ) : null}
            </div>
          ) : (
            <div className={styles.proposalMeta}>
              <span>
                Date: {(aiProposal.captured as ProposedEventCapture).startDate}
                {(aiProposal.captured as ProposedEventCapture).startTime
                  ? ` ${(aiProposal.captured as ProposedEventCapture).startTime}–${(aiProposal.captured as ProposedEventCapture).endTime || ""}`
                  : " (All Day)"}
              </span>
              {(aiProposal.captured as ProposedEventCapture).location ? (
                <span>Location: {(aiProposal.captured as ProposedEventCapture).location}</span>
              ) : null}
            </div>
          )}

          <div className={styles.proposalActions}>
            <Button
              variant="primary"
              size="sm"
              icon={<Check size={14} />}
              disabled={pending}
              onClick={handleCreateFromProposal}
            >
              Create {aiProposal.captured.entityType === "task" ? "Task" : "Event"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              disabled={pending}
              onClick={() => setAiProposal(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.composerFooter}>
        <p id={message ? "capture-message" : "capture-help"} role={message ? "alert" : undefined}>
          {message ?? "Saved as immutable evidence. You decide what it becomes next."}
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            variant="secondary"
            size="md"
            onClick={handleAiParse}
            disabled={pending || aiParsing}
            loading={aiParsing}
            icon={aiParsing ? undefined : <Sparkles size={16} />}
          >
            {aiParsing ? "Parsing…" : "Parse with AI"}
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            disabled={pending || aiParsing}
            loading={pending}
            icon={pending ? undefined : <Send size={16} />}
          >
            {pending ? "Saving…" : "Send to Inbox"}
          </Button>
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

