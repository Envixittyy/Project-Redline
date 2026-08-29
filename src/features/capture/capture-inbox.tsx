"use client";

import { Check, RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import {
  commitCaptureTaskAction,
  prepareCaptureTaskAction,
  undoCaptureTaskAction,
} from "@/features/capture/capture-actions";
import type { CaptureInboxItem } from "@/features/capture/capture-domain";

import styles from "./capture.module.css";

export type CaptureInboxViewItem = CaptureInboxItem & {
  capturedLabel: string;
  canUndo: boolean;
};

function CaptureCard({ item }: { item: CaptureInboxViewItem }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const text = item.content.kind === "text" || item.content.kind === "pasted_text"
    ? item.content.text
    : "";

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Surface variant="base" className={`${styles.captureCard} motion-enter`}>
      <div className={styles.captureMeta}>
        <span>{item.stage === "undone" ? "Undone" : item.stage}</span>
        <time dateTime={item.capturedAt}>{item.capturedLabel}</time>
      </div>
      <p className={styles.rawText}>{text}</p>

      {item.stage === "captured" || item.stage === "failed" ? (
        <div className={styles.cardAction}>
          <p>Ready to interpret this as a task?</p>
          <button
            className={`${styles.secondaryButton} motion-interactive`}
            type="button"
            disabled={pending}
            onClick={() => run(() => prepareCaptureTaskAction(item.id))}
          >
            <Sparkles size={17} aria-hidden="true" />
            {pending ? "Preparing…" : "Propose task"}
          </button>
        </div>
      ) : null}

      {item.stage === "proposed" && item.proposal ? (
        <form
          className={styles.proposal}
          onSubmit={(event) => {
            event.preventDefault();
            const title = String(new FormData(event.currentTarget).get("title") ?? "");
            run(() => commitCaptureTaskAction(item.id, item.proposal?.id, title));
          }}
        >
          <label>
            <span>Proposed task title</span>
            <input name="title" defaultValue={item.proposal.title} maxLength={200} disabled={pending} />
          </label>
          <div className={styles.proposalReview}>
            <p>Nothing is created until you confirm.</p>
            <button className={`${styles.primaryButton} motion-interactive`} type="submit" disabled={pending}>
              <Check size={17} aria-hidden="true" />
              {pending ? "Adding…" : "Add to Tasks"}
            </button>
          </div>
        </form>
      ) : null}

      {item.stage === "committed" ? (
        <div className={styles.cardAction}>
          <p>{item.canUndo ? "Task added. You can still undo this operation." : "Task added to Inbox."}</p>
          {item.canUndo ? (
            <button
              className={`${styles.secondaryButton} motion-interactive`}
              type="button"
              disabled={pending}
              onClick={() => run(() => undoCaptureTaskAction(item.id))}
            >
              <RotateCcw size={17} aria-hidden="true" />
              {pending ? "Undoing…" : "Undo task"}
            </button>
          ) : null}
        </div>
      ) : null}

      {item.stage === "undone" ? <p className={styles.finalState}>The created task was safely removed.</p> : null}
      {item.stage === "interpreted" || item.stage === "confirmed" ? (
        <p className={styles.finalState}>This capture is finishing its current operation. Refresh to check again.</p>
      ) : null}
      {message ? <p className={styles.actionError} role="alert">{message}</p> : null}
    </Surface>
  );
}

export function CaptureInbox({ items }: { items: CaptureInboxViewItem[] }) {
  if (!items.length) {
    return (
      <Surface variant="subtle" className={styles.emptyState}>
        <h2>Your Inbox is quiet</h2>
        <p>Capture something above. It will stay raw until you choose what it should become.</p>
      </Surface>
    );
  }

  return <section className={styles.inboxList} aria-label="Captured items">{items.map((item) => <CaptureCard item={item} key={item.id} />)}</section>;
}
