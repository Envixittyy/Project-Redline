"use client";

import {
  CalendarOff,
  Check,
  ExternalLink,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { fromZonedInputValue, toZonedInputValue } from "@/lib/date/day";
import type { CourseMaterial, TaskCourseMaterialLink } from "@/types/course-material";
import { taskPriorities, taskStatuses, type Task } from "@/types/task";

import {
  createSubtaskAction,
  deleteTaskAction,
  saveTaskAction,
  setTaskCompletionAction,
} from "./task-actions";
import {
  getCourseMaterialsForPickerAction,
  getTaskMaterialsAction,
  linkTaskMaterialsAction,
  unlinkTaskMaterialAction,
} from "./task-material-actions";
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
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [pending, startTransition] = useTransition();

  // Task Materials
  const [materials, setMaterials] = useState<TaskCourseMaterialLink[]>([]);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [availableMaterials, setAvailableMaterials] = useState<CourseMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);

  const completed = task.status === "completed";

  const [fields, setFields] = useState({
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? "",
    dueAt: task.dueAt ? toZonedInputValue(task.dueAt, timeZone) : "",
    scheduledStart: task.scheduledStart ? toZonedInputValue(task.scheduledStart, timeZone) : "",
    scheduledEnd: task.scheduledEnd ? toZonedInputValue(task.scheduledEnd, timeZone) : "",
    area: task.area ?? "",
    project: task.project ?? "",
    course: task.course ?? "",
    courseId: task.courseId ?? "",
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    // Load linked materials for this task
    async function loadMaterials() {
      const res = await getTaskMaterialsAction(task.id);
      if (res.ok) {
        setMaterials(res.materials);
      }
    }
    loadMaterials();
  }, [task.id]);

  function update<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function run(action: () => Promise<{ ok: true; message?: string } | { ok: false; message: string }>) {
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

  async function handleOpenMaterialPicker() {
    const targetCourseId = fields.courseId || task.courseId;
    if (!targetCourseId) return;

    setLoadingMaterials(true);
    const res = await getCourseMaterialsForPickerAction(targetCourseId);
    setLoadingMaterials(false);

    if (res.ok) {
      // Filter out already linked materials
      const existingIds = new Set(materials.map((m) => m.courseMaterialId));
      setAvailableMaterials(res.materials.filter((m) => !existingIds.has(m.id)));
      setSelectedMaterialIds([]);
      setShowMaterialPicker(true);
    } else {
      setError(res.message);
    }
  }

  async function handleAddSelectedMaterials() {
    if (selectedMaterialIds.length === 0) {
      setShowMaterialPicker(false);
      return;
    }

    startTransition(async () => {
      const res = await linkTaskMaterialsAction(task.id, selectedMaterialIds);
      if (res.ok) {
        setShowMaterialPicker(false);
        const updated = await getTaskMaterialsAction(task.id);
        if (updated.ok) setMaterials(updated.materials);
      } else {
        setError(res.message);
      }
    });
  }

  async function handleUnlinkMaterial(courseMaterialId: string) {
    startTransition(async () => {
      const res = await unlinkTaskMaterialAction(task.id, courseMaterialId);
      if (res.ok) {
        setMaterials((current) =>
          current.filter((m) => m.courseMaterialId !== courseMaterialId),
        );
      } else {
        setError(res.message);
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
        // Completed tasks keep their status while their details are edited.
        // Reopening stays an explicit action so completed_at remains valid.
        status: completed ? undefined : fields.status,
        priority: fields.priority,
        dueDate: fields.dueDate,
        dueAt: fields.dueAt ? fromZonedInputValue(fields.dueAt, timeZone) : "",
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

  const hasCourse = Boolean(fields.courseId || fields.course || task.courseId || task.course);
  const effectiveCourseCode = fields.course || (materials[0]?.material.course?.code ?? "");

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
                disabled={completed}
                onChange={(event) => update("status", event.target.value as typeof fields.status)}
              >
                {(completed ? taskStatuses : editableStatuses).map((status) => (
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

          <label className={styles.field}>
            <span>Exact deadline</span>
            <input
              className={styles.control}
              type="datetime-local"
              value={fields.dueAt}
              onChange={(event) => update("dueAt", event.target.value)}
              disabled={!fields.dueDate}
            />
            <small className={styles.hint}>Optional. The deadline must fall on the selected due date.</small>
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

          {/* Related Course Materials Section */}
          {hasCourse ? (
            <div className={styles.materialsSection}>
              <div className={styles.materialsHeader}>
                <span>Related Materials ({materials.length})</span>
                {(fields.courseId || task.courseId) ? (
                  <button
                    type="button"
                    className={styles.subtleButton}
                    style={{ minHeight: "2rem", padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                    onClick={handleOpenMaterialPicker}
                    disabled={pending || loadingMaterials}
                  >
                    <Plus size={14} aria-hidden="true" /> Add material
                  </button>
                ) : null}
              </div>

              {materials.length > 0 ? (
                <ul className={styles.materialsList}>
                  {materials.map((item) => (
                    <li key={item.id} className={styles.materialItem}>
                      <div className={styles.materialInfo}>
                        <span className={styles.materialBadge}>{item.material.type}</span>
                        <strong className={styles.materialTitle}>{item.material.title}</strong>
                        {item.material.url ? (
                          <a
                            href={item.material.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.materialLinkIcon}
                            title="Open resource"
                          >
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={styles.unlinkButton}
                        aria-label={`Unlink ${item.material.title}`}
                        disabled={pending}
                        onClick={() => handleUnlinkMaterial(item.courseMaterialId)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.hint}>
                  No course materials attached to this task yet.
                </p>
              )}

              {/* Course-Scoped Material Picker */}
              {showMaterialPicker ? (
                <div className={styles.pickerBox}>
                  <div className={styles.pickerTitle}>
                    Add material from {effectiveCourseCode || "associated course"}:
                  </div>

                  {availableMaterials.length > 0 ? (
                    <div className={styles.pickerList}>
                      {availableMaterials.map((mat) => {
                        const checked = selectedMaterialIds.includes(mat.id);
                        return (
                          <label key={mat.id} className={styles.pickerOption}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMaterialIds((ids) => [...ids, mat.id]);
                                } else {
                                  setSelectedMaterialIds((ids) =>
                                    ids.filter((id) => id !== mat.id),
                                  );
                                }
                              }}
                            />
                            <span className={styles.materialBadge}>{mat.type}</span>
                            <span style={{ fontWeight: 600 }}>{mat.title}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={styles.hint}>
                      All materials for this course are already linked, or no materials exist in School.
                    </p>
                  )}

                  <div className={styles.pickerActions}>
                    <button
                      type="button"
                      className={styles.subtleButton}
                      style={{ minHeight: "2.2rem" }}
                      onClick={() => setShowMaterialPicker(false)}
                    >
                      Cancel
                    </button>
                    {availableMaterials.length > 0 ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        style={{ minHeight: "2.2rem" }}
                        disabled={pending || selectedMaterialIds.length === 0}
                        onClick={handleAddSelectedMaterials}
                      >
                        Add Selected ({selectedMaterialIds.length})
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.pair}>
            <label className={styles.field}>
              <span>Add subtask</span>
              <input
                className={styles.control}
                value={subtaskTitle}
                maxLength={200}
                placeholder="A smaller next step"
                onChange={(event) => setSubtaskTitle(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pending || !subtaskTitle.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await createSubtaskAction(task.id, subtaskTitle);
                  if (result.ok) {
                    setSubtaskTitle("");
                    setError(null);
                  } else setError(result.message);
                })
              }
            >
              <Plus size={16} /> Add subtask
            </button>
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
