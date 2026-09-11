"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { courseMaterialTypes, type CourseMaterial } from "@/types/course-material";
import { saveCourseMaterialAction } from "./school-material-actions";

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
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", width: "100%" }}>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving..." : isEditing ? "Save changes" : "Add material"}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {error ? (
          <div
            style={{
              padding: "0.6rem 0.8rem",
              borderRadius: "var(--radius-sm)",
              background: "color-mix(in oklch, var(--destructive) 15%, transparent)",
              color: "var(--destructive)",
              fontSize: "0.8125rem",
              fontWeight: 600,
            }}
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div>
          <label
            htmlFor="material-title"
            style={{
              display: "block",
              marginBottom: "0.35rem",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--text-secondary)",
            }}
          >
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label
              htmlFor="material-type"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Material Type *
            </label>
            <select
              id="material-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{
                width: "100%",
                minHeight: "2.75rem",
                padding: "0.6rem 0.75rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-primary)",
                font: "inherit",
                fontSize: "0.875rem",
              }}
            >
              {courseMaterialTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="material-url"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
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

        <div>
          <label
            htmlFor="material-desc"
            style={{
              display: "block",
              marginBottom: "0.35rem",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--text-secondary)",
            }}
          >
            Notes / Instructions (Optional)
          </label>
          <textarea
            id="material-desc"
            rows={3}
            placeholder="Key concepts, reading instructions, or exam guidelines..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: "100%",
              minHeight: "4rem",
              padding: "0.6rem 0.75rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              font: "inherit",
              fontSize: "0.875rem",
              resize: "vertical",
            }}
          />
        </div>
      </form>
    </Modal>
  );
}
