"use client";

import { CalendarOff, Check, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { fromZonedInputValue, toZonedInputValue } from "@/lib/date/day";
import { taskPriorities, taskStatuses, type Task } from "@/types/task";

import { deleteTaskAction, saveTaskAction, setTaskCompletionAction } from "./task-actions";
import styles from "./task-editor.module.css";

/** Completion has its own control, so it is not offered as an editable status. */
const editableStatuses = taskStatuses.filter((status) => status.id !== "completed");

type TaskEditorProps = {
  task: Task;
  timeZone: string;
  onClose: () => void;
};

export function TaskEditor({ task, timeZone, onClose }: TaskEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const completed = task.status === "completed";

  const [fields, setFields] = useState({
    title: task.title,
    description: task.description ?? "",
    status: completed ? "todo" : task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? "",
    scheduledStart: task.scheduledStart ? toZonedInputValue(task.scheduledStart, timeZone) : "",
    scheduledEnd: task.scheduledEnd ? toZonedInputValue(task.scheduledEnd, timeZone) : "",
    area: task.area ?? "",
    project: task.project ?? "",
    course: task.course ?? "",
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function update<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onClose();
      } else {
        setError(result.message);
      }
    });
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (fields.title.trim() === "") {
      setError("Give the task a title.");
      return;
    }

    run(() =>
      saveTaskAction(task.id, {
        title: fields.title,
        description: fields.description,
        status: fields.status,
        priority: fields.priority,
        dueDate: fields.dueDate,
        // datetime-local carries a wall clock; convert it in the workspace zone.
        scheduledStart: fields.scheduledStart
          ? fromZonedInputValue(fields.scheduledStart, timeZone)
          : "",
        scheduledEnd: fields.scheduledEnd ? fromZonedInputValue(fields.scheduledEnd, timeZone) : "",
        area: fields.area,
        project: fields.project,
        course: fields.course,
      }),
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="task-editor-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form className={styles.form} onSubmit={handleSave}>
        <header className={styles.header}>
          <h2 className={styles.heading} id="task-editor-title">
            Edit task
          </h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close editor"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.field}>
            <span>Title</span>
            <input
              className={styles.control}
              value={fields.title}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => update("title", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Notes</span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={fields.description}
              onChange={(event) => update("description", event.target.value)}
            />
          </label>

          <div className={styles.pair}>
            <label className={styles.field}>
              <span>Status</span>
              <select
                className={styles.control}
                value={fields.status}
                onChange={(event) => update("status", event.target.value as typeof fields.status)}
              >
                {editableStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Priority</span>
              <select
                className={styles.control}
                value={fields.priority}
                onChange={(event) =>
                  update("priority", event.target.value as typeof fields.priority)
                }
              >
                {taskPriorities.map((priority) => (
                  <option key={priority.id} value={priority.id}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.field}>
            <span>Due date</span>
            <input
              className={styles.control}
              type="date"
              value={fields.dueDate}
              onChange={(event) => update("dueDate", event.target.value)}
            />
          </label>

          <fieldset className={styles.schedule}>
            <legend>Scheduled time</legend>
            <p className={styles.hint}>
              Scheduling a task records when you plan to work on it. It stays a task and never
              becomes a calendar event.
            </p>

            <div className={styles.pair}>
              <label className={styles.field}>
                <span>Starts</span>
                <input
                  className={styles.control}
                  type="datetime-local"
                  value={fields.scheduledStart}
                  onChange={(event) => update("scheduledStart", event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span>Ends</span>
                <input
                  className={styles.control}
                  type="datetime-local"
                  value={fields.scheduledEnd}
                  min={fields.scheduledStart || undefined}
                  disabled={fields.scheduledStart === ""}
                  onChange={(event) => update("scheduledEnd", event.target.value)}
                />
              </label>
            </div>

            {fields.scheduledStart ? (
              <button
                type="button"
                className={styles.subtleButton}
                onClick={() => setFields((current) => ({ ...current, scheduledStart: "", scheduledEnd: "" }))}
              >
                <CalendarOff size={15} aria-hidden="true" />
                Remove scheduling
              </button>
            ) : null}
          </fieldset>

          <div className={styles.trio}>
            <label className={styles.field}>
              <span>Area</span>
              <input
                className={styles.control}
                value={fields.area}
                autoComplete="off"
                onChange={(event) => update("area", event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>Project</span>
              <input
                className={styles.control}
                value={fields.project}
                autoComplete="off"
                onChange={(event) => update("project", event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>Course</span>
              <input
                className={styles.control}
                value={fields.course}
                autoComplete="off"
                onChange={(event) => update("course", event.target.value)}
              />
            </label>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerLeft}>
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className={styles.dangerButton}
                  disabled={pending}
                  onClick={() => run(() => deleteTaskAction(task.id))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete for good
                </button>
                <button
                  type="button"
                  className={styles.subtleButton}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.subtleButton}
                disabled={pending}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete
              </button>
            )}
          </div>

          <div className={styles.footerRight}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pending}
              onClick={() => run(() => setTaskCompletionAction(task.id, !completed))}
            >
              {completed ? (
                <>
                  <RotateCcw size={16} aria-hidden="true" />
                  Reopen
                </>
              ) : (
                <>
                  <Check size={16} aria-hidden="true" />
                  Complete
                </>
              )}
            </button>

            <button type="submit" className={styles.primaryButton} disabled={pending}>
              {pending ? "Saving" : "Save"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
