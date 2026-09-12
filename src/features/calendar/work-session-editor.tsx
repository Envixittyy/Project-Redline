"use client";

import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { DateTimePicker, Select } from "@/components/ui";
import { fromZonedInputValue, toZonedInputValue } from "@/lib/date/day";
import type { WorkSession } from "@/types/work-session";

import {
  createWorkSessionAction,
  deleteWorkSessionAction,
  saveWorkSessionAction,
} from "./work-session-actions";
import styles from "./event-editor.module.css";

type TaskOption = { id: string; title: string };

export function WorkSessionEditor({
  session,
  initialDate,
  taskOptions,
  timeZone,
  onClose,
}: {
  session: WorkSession | null;
  initialDate: string;
  taskOptions: TaskOption[];
  timeZone: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const initialStart = session
    ? toZonedInputValue(session.startsAt, timeZone)
    : `${initialDate}T09:00`;
  const initialEnd = session
    ? toZonedInputValue(session.endsAt, timeZone)
    : `${initialDate}T10:00`;
  const [fields, setFields] = useState({
    taskId: session?.taskId ?? taskOptions[0]?.id ?? "",
    startsAt: initialStart,
    endsAt: initialEnd,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) onClose();
      else setError(result.message);
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const input = {
        taskId: fields.taskId,
        startsAt: fromZonedInputValue(fields.startsAt, timeZone),
        endsAt: fromZonedInputValue(fields.endsAt, timeZone),
      };
      run(() => session
        ? saveWorkSessionAction(session.id, input)
        : createWorkSessionAction(input));
    } catch {
      setError("Choose valid work-session times.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="work-session-editor-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form className={styles.form} onSubmit={submit}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Task work session</p>
            <h2 id="work-session-editor-title">{session ? "Edit planned work" : "Plan task work"}</h2>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close editor" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.field}>
            <span>Task</span>
            <Select
              value={fields.taskId}
              disabled={taskOptions.length === 0}
              onChange={(value) => setFields((current) => ({ ...current, taskId: value }))}
              placeholder={taskOptions.length === 0 ? "Create a task first" : "Select task…"}
              ariaLabel="Task"
              options={taskOptions.map((task) => ({
                value: task.id,
                label: task.title,
              }))}
            />
          </div>

          <div className={styles.pair}>
            <div className={styles.field}>
              <span>Starts</span>
              <DateTimePicker
                required
                value={fields.startsAt}
                onChange={(value) => setFields((current) => ({ ...current, startsAt: value }))}
                ariaLabel="Starts"
              />
            </div>
            <div className={styles.field}>
              <span>Ends</span>
              <DateTimePicker
                required
                min={fields.startsAt}
                value={fields.endsAt}
                onChange={(value) => setFields((current) => ({ ...current, endsAt: value }))}
                ariaLabel="Ends"
              />
            </div>
          </div>

          <p className={styles.hint}>This creates a task-owned work block. It does not change the task deadline or create an event.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>

        <footer className={styles.footer}>
          {session ? (
            confirmingDelete ? (
              <span className={styles.confirmGroup}>
                <button type="button" className={styles.secondaryButton} disabled={pending} onClick={() => setConfirmingDelete(false)}>Keep</button>
                <button type="button" className={styles.dangerButton} disabled={pending} onClick={() => run(() => deleteWorkSessionAction(session.id))}>Delete</button>
              </span>
            ) : (
              <button type="button" className={styles.dangerButton} disabled={pending} onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            )
          ) : <span />}
          <button type="submit" className={styles.primaryButton} disabled={pending || taskOptions.length === 0}>
            {pending ? "Saving…" : session ? "Save session" : "Plan work"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
