"use client";

import { Check, FileUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { ModalFrame } from "@/components/ui/modal-frame";
import { TimePicker } from "@/components/ui/time-picker";
import { generateCourseImport } from "@/features/ai/course-import-client";
import {
  applyCourseImportAction,
  rejectCourseImportAction,
  reviseCourseImportAction,
} from "@/features/ai/course-import-actions";
import type {
  CourseImportReview,
  CourseProposal,
  ProposedCourseMeeting,
} from "@/services/integrations/ai/course-import-contract";
import styles from "./course-import-modal.module.css";
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function CourseImportModal({ onClose }: { onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<CourseImportReview | null>(null);
  const [proposal, setProposal] = useState<CourseProposal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, startApplyTransition] = useTransition();
  useEffect(() => () => controller.current?.abort(), []);
  function acceptReview(next: CourseImportReview) {
    setReview(next);
    setProposal(next.proposal);
    setDirty(false);
    setError(null);
  }
  function reset() {
    if (applying) return;
    controller.current?.abort();
    if (review) void rejectCourseImportAction(review.batchId);
    setReview(null);
    setProposal(null);
    setDirty(false);
    setError(null);
  }
  function close() {
    if (!applying) {
      reset();
      onClose();
    }
  }
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    const abort = new AbortController();
    controller.current = abort;
    const result = await generateCourseImport(file, abort.signal);
    if (abort.signal.aborted) {
      if (result.ok) void rejectCourseImportAction(result.review.batchId);
      return;
    }
    if (result.ok) acceptReview(result.review);
    else setError(result.message);
    setLoading(false);
    e.target.value = "";
  }
  function handleUpdateProposal(patch: Partial<CourseProposal>) {
    if (!proposal) return;
    setProposal({ ...proposal, ...patch });
    setDirty(true);
  }
  function handleUpdateMeeting(
    index: number,
    patch: Partial<ProposedCourseMeeting>,
  ) {
    if (!proposal) return;
    handleUpdateProposal({
      meetings: proposal.meetings.map((m, i) =>
        i === index ? { ...m, ...patch } : m,
      ),
    });
  }
  function handleToggleWeekday(index: number, day: number) {
    if (!proposal) return;
    const days = proposal.meetings[index].weekdays;
    handleUpdateMeeting(index, {
      weekdays: days.includes(day)
        ? days.filter((d) => d !== day)
        : [...days, day].sort(),
    });
  }
  function handleAddMeeting() {
    if (!proposal || proposal.meetings.length >= 7) return;
    handleUpdateProposal({
      meetings: [
        ...proposal.meetings,
        {
          title: "Lecture",
          weekdays: [1],
          startTime: "09:00",
          endTime: "10:00",
          location: null,
        },
      ],
    });
  }
  function handleRemoveMeeting(index: number) {
    if (proposal)
      handleUpdateProposal({
        meetings: proposal.meetings.filter((_, i) => i !== index),
      });
  }
  function handleApply() {
    if (!review || !proposal) return;
    startApplyTransition(async () => {
      try {
        if (dirty) {
          const result = await reviseCourseImportAction(
            review.batchId,
            proposal,
          );
          if (result.ok) acceptReview(result.review);
          else setError(result.message);
          return; // Newly persisted edits need a separate explicit approval.
        }
        const result = await applyCourseImportAction(review.batchId);
        if (result.ok) onClose();
        else setError(result.message);
      } catch {
        setError(
          "Course import unavailable. Refresh the review before retrying.",
        );
      }
    });
  }
  return (
    <ModalFrame
      label="AI Course Document Import"
      className={`${styles.panel} motion-enter`}
      onClose={close}
    >
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>AI Course Document Import</h2>
          <div className={styles.subtitle}>
            Selected text is retained with the private review audit. Your AI mode selects inference; cloud transfer asks first.
            No changes until approval. TXT, MD, CSV, ICS only; 256 KiB
            file, 25,000 characters, 32 KiB context.
          </div>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={close}
          disabled={applying}
          aria-label="Close modal"
        >
          <X size={16} />
        </button>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      {!proposal ? (
        <div>
          <button
            type="button"
            disabled={loading}
            className={styles.dropzone}
            onClick={() => fileInputRef.current?.click()}
          >
            {loading ? (
              <>
                <Loader2
                  size={32}
                  className={`${styles.dropzoneIcon} animate-spin`}
                />
                <span className={styles.dropzoneText}>
                  Extracting timetable from document…
                </span>
                <span className={styles.dropzoneHint}>
                  AI is proposing course details and meetings
                </span>
              </>
            ) : (
              <>
                <FileUp size={32} className={styles.dropzoneIcon} />
                <span className={styles.dropzoneText}>
                  Select syllabus or schedule file
                </span>
                <span className={styles.dropzoneHint}>
                  Supports CSV, plain text (.txt), Markdown (.md), and iCalendar
                  (.ics)
                </span>
              </>
            )}
          </button>
          <input
            aria-label="Select course document"
            ref={fileInputRef}
            type="file"
            className={styles.fileInput}
            accept=".txt,.md,.csv,.ics,text/plain,text/csv,text/markdown,text/calendar"
            onChange={handleFileChange}
            disabled={loading}
          />
        </div>
      ) : (
        <fieldset disabled={applying} className={styles.reviewSection}>
          <legend>Review proposed course</legend>
          {review?.provenance && <p>Source: {review.provenance.location.replaceAll("_", " ")} · {review.provenance.provider} · {review.provenance.model}</p>}
          <p>
            {review?.fileName} · Meetings start {review?.startDate} ·{" "}
            {review?.timeZone}. No end date; adjust later in School. Review
            expires five minutes after upload.
          </p>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Course Code</span>
              <input
                className={styles.input}
                value={proposal.code}
                maxLength={20}
                onChange={(e) =>
                  handleUpdateProposal({ code: e.target.value.toUpperCase() })
                }
              />
            </label>

            <label className={styles.field}>
              <span>Course Name</span>
              <input
                className={styles.input}
                value={proposal.name}
                maxLength={100}
                onChange={(e) => handleUpdateProposal({ name: e.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span>Instructor (Optional)</span>
              <input
                className={styles.input}
                maxLength={100}
                value={proposal.instructor || ""}
                placeholder="e.g. Dr. Turing"
                onChange={(e) =>
                  handleUpdateProposal({ instructor: e.target.value || null })
                }
              />
            </label>

            <label className={styles.field}>
              <span>Default Location (Optional)</span>
              <input
                className={styles.input}
                maxLength={100}
                value={proposal.location || ""}
                placeholder="e.g. Hall A"
                onChange={(e) =>
                  handleUpdateProposal({ location: e.target.value || null })
                }
              />
            </label>
          </div>

          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.4rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "var(--text-secondary)",
                  textTransform: "uppercase",
                }}
              >
                Recurring Meetings ({proposal.meetings.length})
              </span>
              <button
                type="button"
                onClick={handleAddMeeting}
                disabled={proposal.meetings.length >= 7}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  border: 0,
                  background: "transparent",
                  color: "var(--accent-text)",
                  minHeight: "2.75rem",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> Add meeting slot
              </button>
            </div>

            <div className={styles.meetingList}>
              {proposal.meetings.map((meeting, index) => (
                <div key={index} className={styles.meetingCard}>
                  <div className={styles.meetingHeader}>
                    <input
                      className={styles.input}
                      aria-label={`Meeting ${index + 1} title`}
                      maxLength={100}
                      value={meeting.title}
                      onChange={(e) =>
                        handleUpdateMeeting(index, { title: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className={styles.closeButton}
                      onClick={() => handleRemoveMeeting(index)}
                      aria-label="Remove meeting"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className={styles.weekdaySelector}>
                    {weekdays.map((dayLabel, dIdx) => (
                      <button
                        key={dIdx}
                        type="button"
                        className={styles.weekdayPill}
                        data-selected={meeting.weekdays.includes(dIdx)}
                        aria-pressed={meeting.weekdays.includes(dIdx)}
                        aria-label={dayLabel}
                        onClick={() => handleToggleWeekday(index, dIdx)}
                      >
                        {dayLabel.slice(0, 1)}
                      </button>
                    ))}
                  </div>

                  <div className={styles.timeRow}>
                    <TimePicker
                      className={styles.timeInput}
                      ariaLabel={`Meeting ${index + 1} start time`}
                      value={meeting.startTime}
                      onChange={(value) =>
                        handleUpdateMeeting(index, {
                          startTime: value,
                        })
                      }
                    />
                    <span style={{ color: "var(--text-tertiary)" }}>to</span>
                    <TimePicker
                      className={styles.timeInput}
                      ariaLabel={`Meeting ${index + 1} end time`}
                      value={meeting.endTime}
                      onChange={(value) =>
                        handleUpdateMeeting(index, { endTime: value })
                      }
                    />
                    <input
                      className={styles.input}
                      aria-label={`Meeting ${index + 1} location`}
                      maxLength={100}
                      placeholder="Location override"
                      value={meeting.location || ""}
                      onChange={(e) =>
                        handleUpdateMeeting(index, {
                          location: e.target.value || null,
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={reset}
              disabled={applying}
            >
              Reset
            </button>
            <button
              type="button"
              className={`${styles.submitButton} motion-tactile`}
              onClick={handleApply}
              disabled={applying || !proposal.code || !proposal.name}
            >
              {applying ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              <span>
                {applying
                  ? "Saving…"
                  : dirty
                    ? "Save edits for review"
                    : "Approve & create course"}
              </span>
            </button>
          </div>
        </fieldset>
      )}
    </ModalFrame>
  );
}
