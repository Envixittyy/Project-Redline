"use client";

import { Plus, Loader2, Flag } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { DatePicker, Select } from "@/components/ui";
import { enqueueOfflineMutation } from "@/lib/offline/queue";
import { taskPriorities } from "@/types/task";

import { createTaskAction } from "./task-actions";
import styles from "./quick-add.module.css";

/**
 * The fast path: a title, and optionally a due date and priority. Everything
 * else is set in the editor, so capture never gets in the way.
 */
export function QuickAdd({ defaultDueDate }: { defaultDueDate?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dueDate, setDueDate] = useState(defaultDueDate || "");
  const [priority, setPriority] = useState("none");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "");

    if (title.trim() === "") {
      setError("Give the task a title.");
      titleRef.current?.focus();
      return;
    }

    startTransition(async () => {
      const payload = {
        title,
        dueDate: String(data.get("dueDate") ?? dueDate),
        priority: String(data.get("priority") ?? priority),
      };
      if (!navigator.onLine) {
        await enqueueOfflineMutation({ id: crypto.randomUUID(), kind: "task_create", payload });
        setError("Saved offline. This task is pending synchronization.");
        formRef.current?.reset();
        setDueDate(defaultDueDate || "");
        setPriority("none");
        titleRef.current?.focus();
        return;
      }
      let result;
      try {
        result = await createTaskAction(payload);
      } catch {
        await enqueueOfflineMutation({ id: crypto.randomUUID(), kind: "task_create", payload });
        setError("Connection lost. This task is pending synchronization.");
        formRef.current?.reset();
        setDueDate(defaultDueDate || "");
        setPriority("none");
        return;
      }

      if (result.ok) {
        setError(null);
        formRef.current?.reset();
        setDueDate(defaultDueDate || "");
        setPriority("none");
        titleRef.current?.focus();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <section className={styles.composer} aria-label="Quick add task">
      <form
        ref={formRef}
        id="tasks-quick-add"
        className={styles.form}
        onSubmit={handleSubmit}
        noValidate
      >
        <div className={styles.inputRow}>
          <label className={styles.titleField}>
            <span className={styles.visuallyHidden}>Task title</span>
            <input
              ref={titleRef}
              className={styles.titleInput}
              name="title"
              type="text"
              maxLength={200}
              placeholder="Add a task… (Press Enter to save)"
              autoComplete="off"
              enterKeyHint="done"
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "quick-add-error" : undefined}
            />
          </label>

          <button
            className={styles.submitButton}
            type="submit"
            disabled={pending}
            aria-label={pending ? "Adding task" : "Add task"}
          >
            {pending ? (
              <Loader2 size={16} className={styles.spinner} aria-hidden="true" />
            ) : (
              <Plus size={16} aria-hidden="true" />
            )}
            <span className={styles.submitLabel}>{pending ? "Adding" : "Add"}</span>
          </button>
        </div>

        <div className={styles.optionsStrip}>
          <div className={styles.optionPill}>
            <span className={styles.optionLabel}>Due:</span>
            <DatePicker
              name="dueDate"
              value={dueDate}
              onChange={setDueDate}
              compact
              disabled={pending}
              ariaLabel="Task due date"
            />
          </div>

          <div className={styles.optionPill}>
            <Flag size={13} className={styles.optionIcon} aria-hidden="true" />
            <span className={styles.optionLabel}>Priority:</span>
            <Select
              name="priority"
              value={priority}
              onChange={setPriority}
              disabled={pending}
              className={styles.prioritySelect}
              ariaLabel="Task priority"
              options={taskPriorities.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </div>
        </div>

        {error ? (
          <p className={styles.error} id="quick-add-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
