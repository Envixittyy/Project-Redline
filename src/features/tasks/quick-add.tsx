"use client";

import { Plus } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
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
        dueDate: String(data.get("dueDate") ?? ""),
        priority: String(data.get("priority") ?? "none"),
      };
      if (!navigator.onLine) {
        await enqueueOfflineMutation({ id: crypto.randomUUID(), kind: "task_create", payload });
        setError("Saved offline. This task is pending synchronization.");
        formRef.current?.reset();
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
        return;
      }

      if (result.ok) {
        setError(null);
        formRef.current?.reset();
        titleRef.current?.focus();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <Surface variant="glass" className={styles.card}>
      <form ref={formRef} className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.primaryRow}>
          <label className={styles.titleField}>
            <span className={styles.visuallyHidden}>Task title</span>
            <input
              ref={titleRef}
              className={styles.titleInput}
              name="title"
              type="text"
              maxLength={200}
              placeholder="Add a task"
              autoComplete="off"
              enterKeyHint="done"
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "quick-add-error" : undefined}
            />
          </label>

          <button className={styles.submit} type="submit" disabled={pending}>
            <Plus size={18} aria-hidden="true" />
            <span>{pending ? "Adding" : "Add"}</span>
          </button>
        </div>

        <div className={styles.optionsRow}>
          <label className={styles.option}>
            <span>Due</span>
            <input
              className={styles.control}
              name="dueDate"
              type="date"
              defaultValue={defaultDueDate}
              disabled={pending}
            />
          </label>

          <label className={styles.option}>
            <span>Priority</span>
            <select className={styles.control} name="priority" defaultValue="none" disabled={pending}>
              {taskPriorities.map((priority) => (
                <option key={priority.id} value={priority.id}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <p className={styles.error} id="quick-add-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Surface>
  );
}
