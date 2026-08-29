"use client";

import { Inbox, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import { createCaptureAction } from "@/features/capture/capture-actions";

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

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("capture") ?? "");
    if (!text.trim()) {
      setMessage("Write something to capture first.");
      textareaRef.current?.focus();
      return;
    }

    startTransition(async () => {
      const result = await createCaptureAction(text);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      form.reset();
      setMessage(null);
      router.refresh();
      onCaptured?.();
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
          placeholder="Drop a thought, reminder, or pasted text here…"
          disabled={pending}
          aria-describedby={message ? "capture-message" : "capture-help"}
        />
      </label>
      <div className={styles.composerFooter}>
        <p id={message ? "capture-message" : "capture-help"} role={message ? "alert" : undefined}>
          {message ?? "Saved as immutable evidence. You decide what it becomes next."}
        </p>
        <button className={`${styles.primaryButton} motion-interactive`} type="submit" disabled={pending}>
          <Send size={17} aria-hidden="true" />
          {pending ? "Saving…" : "Send to Inbox"}
        </button>
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
