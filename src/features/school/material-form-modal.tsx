"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { courseMaterialTypes, type CourseMaterial } from "@/types/course-material";
import { saveCourseMaterialAction } from "./school-material-actions";
import styles from "./course-form-modal.module.css";

type MaterialFormModalProps = {
  courseId: string;
  courseCode: string;
  material?: CourseMaterial | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function MaterialFormModal({
  courseId,
  courseCode,
  material,
  onClose,
  onSaved,
}: MaterialFormModalProps) {
  const [title, setTitle] = useState(material?.title ?? "");
  const [type, setType] = useState<string>(material?.type ?? "document");
  const [url, setUrl] = useState(material?.url ?? "");
  const [description, setDescription] = useState(material?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEditing = Boolean(material?.id);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Material title is required.");
      return;
    }

    startTransition(async () => {
      const res = await saveCourseMaterialAction(courseId, material?.id ?? null, {
        title: title.trim(),
        type,
        url: url.trim() || null,
        description: description.trim() || null,
      });

      if (res.ok) {
        setError(null);
        onSaved?.();
        onClose();
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <Modal
      isOpen
      title={isEditing ? `Edit Material for ${courseCode}` : `Add Material to ${courseCode}`}
      description="Attach syllabi, lecture slides, readings, or resource links."
      onClose={onClose}
      footer={
        <div className={styles.footerActions}>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving..." : isEditing ? "Save changes" : "Add material"}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        {error ? (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        ) : null}

        <div className={styles.field}>
          <label htmlFor="material-title" className={styles.label}>
            Material Title *
          </label>
          <Input
            id="material-title"
            placeholder="e.g. Week 1 Lecture Slides / Syllabus"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            autoFocus
          />
        </div>

        <div className={styles.grid2Col}>
          <div className={styles.field}>
            <label htmlFor="material-type" className={styles.label}>
              Material Type *
            </label>
            <select
              id="material-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={styles.select}
            >
              {courseMaterialTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="material-url" className={styles.label}>
              Link / URL (Optional)
            </label>
            <Input
              id="material-url"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="material-desc" className={styles.label}>
            Notes / Instructions (Optional)
          </label>
          <textarea
            id="material-desc"
            rows={3}
            placeholder="Key concepts, reading instructions, or exam guidelines..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={styles.textarea}
          />
        </div>
      </form>
    </Modal>
  );
}
