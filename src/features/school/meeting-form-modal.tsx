"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PersistedCourseMeeting } from "@/types/course";
import { saveMeetingAction } from "./school-actions";

const WEEKDAYS = [
  { index: 1, label: "Mon" },
  { index: 2, label: "Tue" },
  { index: 3, label: "Wed" },
  { index: 4, label: "Thu" },
  { index: 5, label: "Fri" },
  { index: 6, label: "Sat" },
  { index: 0, label: "Sun" },
];

type MeetingFormModalProps = {
  courseId: string;
  courseCode: string;
  courseLocation?: string | null;
  today: string;
  timeZone: string;
  meeting?: PersistedCourseMeeting | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function MeetingFormModal({
  courseId,
  courseCode,
  courseLocation,
  today,
  timeZone,
  meeting,
  onClose,
  onSaved,
}: MeetingFormModalProps) {
  const [title, setTitle] = useState(meeting?.title ?? "Lecture");
  const [weekdays, setWeekdays] = useState<number[]>(meeting?.weekdays ?? [1, 3]); // Mon, Wed default
  const [startDate, setStartDate] = useState(meeting?.startDate ?? today);
  const [endDate, setEndDate] = useState(meeting?.endDateExclusive ?? "");
  const [startTime, setStartTime] = useState(meeting?.startTime ?? "10:00");
  const [endTime, setEndTime] = useState(meeting?.endTime ?? "11:30");
  const [location, setLocation] = useState(meeting?.location ?? courseLocation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEditing = Boolean(meeting?.id);

  function toggleWeekday(dayIndex: number) {
    setWeekdays((prev) =>
      prev.includes(dayIndex)
        ? prev.filter((d) => d !== dayIndex)
        : [...prev, dayIndex].sort((a, b) => a - b),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Meeting title is required.");
      return;
    }
    if (weekdays.length === 0) {
      setError("Please select at least one day of the week.");
      return;
    }
    if (!startTime || !endTime) {
      setError("Start and end times are required.");
      return;
    }

    startTransition(async () => {
      const res = await saveMeetingAction(meeting?.id ?? null, {
        courseId,
        title: title.trim(),
        weekdays,
        startDate,
        endDateExclusive: endDate.trim() || null,
        startTime,
        endTime,
        timeZone,
        location: location.trim() || null,
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
      title={isEditing ? `Edit Meeting for ${courseCode}` : `Add Class Meeting for ${courseCode}`}
      description="Configure recurring lecture, lab, seminar, or discussion times."
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", width: "100%" }}>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving..." : isEditing ? "Save meeting" : "Add meeting"}
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label
              htmlFor="meeting-title"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Meeting Title *
            </label>
            <Input
              id="meeting-title"
              placeholder="e.g. Lecture, Lab, Discussion"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="meeting-location"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Room / Location
            </label>
            <Input
              id="meeting-location"
              placeholder="e.g. Hall 101 or Zoom"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: "0.4rem",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--text-secondary)",
            }}
          >
            Recurring Days *
          </label>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {WEEKDAYS.map((day) => {
              const active = weekdays.includes(day.index);
              return (
                <button
                  key={day.index}
                  type="button"
                  onClick={() => toggleWeekday(day.index)}
                  style={{
                    minWidth: "2.75rem",
                    minHeight: "2.75rem",
                    borderRadius: "var(--radius-md)",
                    border: active ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                    background: active ? "var(--accent)" : "var(--surface)",
                    color: active ? "var(--accent-foreground)" : "var(--text-secondary)",
                    font: "inherit",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all var(--motion-fast) var(--motion-ease)",
                  }}
                  aria-pressed={active}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label
              htmlFor="meeting-start-time"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Start Time *
            </label>
            <Input
              id="meeting-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>

          <div>
            <label
              htmlFor="meeting-end-time"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              End Time *
            </label>
            <Input
              id="meeting-end-time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label
              htmlFor="meeting-start-date"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Semester Starts *
            </label>
            <Input
              id="meeting-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label
              htmlFor="meeting-end-date"
              style={{
                display: "block",
                marginBottom: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              Semester Ends (Optional)
            </label>
            <Input
              id="meeting-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
