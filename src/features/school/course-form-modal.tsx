"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Course } from "@/types/course";
import { saveCourseAction } from "./school-actions";

const COLOR_PRESETS = [
  "#2563eb", // Royal Blue
  "#0284c7", // Sky Blue
  "#0d9488", // Teal
  "#059669", // Emerald
  "#d97706", // Amber
  "#7c3aed", // Violet
  "#db2777", // Pink
  "#475569", // Slate
];

type CourseFormModalProps = {
  course?: Course | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function CourseFormModal({
  course,
  onClose,
  onSaved,
}: CourseFormModalProps) {
  const [code, setCode] = useState(course?.code ?? "");
  const [name, setName] = useState(course?.name ?? "");
  const [instructor, setInstructor] = useState(course?.instructor ?? "");
  const [location, setLocation] = useState(course?.location ?? "");
  const [color, setColor] = useState(course?.color ?? COLOR_PRESETS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEditing = Boolean(course?.id);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setError("Course code and name are required.");
      return;
    }

    startTransition(async () => {
      const res = await saveCourseAction(course?.id ?? null, {
        code: code.trim(),
        name: name.trim(),
        instructor: instructor.trim() || null,
        location: location.trim() || null,
        color,
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
      title={isEditing ? `Edit ${course?.code}` : "Add Course"}
      description={
        isEditing
          ? "Update course details, location, and visual color."
          : "Add a course to organize lectures, assignments, materials, and Blackboard updates."
      }
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", width: "100%" }}>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving..." : isEditing ? "Save changes" : "Create course"}
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.75rem" }}>
          <div>
            <label
              htmlFor="course-code"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Course Code *
            </label>
            <Input
              id="course-code"
              placeholder="e.g. CS101"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={30}
              required
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="course-name"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Course Name *
            </label>
            <Input
              id="course-name"
              placeholder="e.g. Intro to Computer Science"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label
              htmlFor="course-instructor"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Instructor (Optional)
            </label>
            <Input
              id="course-instructor"
              placeholder="e.g. Dr. Alan Turing"
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              maxLength={200}
            />
          </div>

          <div>
            <label
              htmlFor="course-location"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Default Room / Location
            </label>
            <Input
              id="course-location"
              placeholder="e.g. Turing Hall 301"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={200}
            />
          </div>
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: "0.45rem",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--text-secondary)",
            }}
          >
            Course Accent Color
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                style={{
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "50%",
                  backgroundColor: preset,
                  border: color === preset ? "2.5px solid var(--text-primary)" : "2px solid transparent",
                  outlineOffset: "2px",
                  cursor: "pointer",
                  transition: "transform var(--motion-fast) var(--motion-ease)",
                  transform: color === preset ? "scale(1.15)" : "scale(1)",
                  padding: 0,
                }}
                aria-label={`Select color ${preset}`}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="Custom color"
              style={{
                width: "2rem",
                height: "2rem",
                padding: 0,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                background: "transparent",
              }}
              aria-label="Custom color picker"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
