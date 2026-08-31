"use client";

import {
  Calendar,
  Check,
  FileText,
  FileUp,
  GraduationCap,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { generateRoutedProposal } from "@/features/ai/routing-client";
import { getCompanionSession } from "@/services/integrations/ai/companion-session";
import type { CourseWithMeetings } from "@/types/course";
import type {
  ScheduleReview,
  ProposedCourseSchedule,
} from "@/services/integrations/ai/school-schedule-contract";
import type {
  BlackboardCourseReview,
  ProposedBlackboardCourse,
} from "@/services/integrations/ai/blackboard-screenshot-contract";
import type {
  AcademicCalendarReview,
  ProposedAcademicEvent,
} from "@/services/integrations/ai/academic-calendar-contract";
import type { CourseImportReview, CourseProposal } from "@/services/integrations/ai/course-import-contract";
import {
  applyScheduleImportAction,
  reviseScheduleImportAction,
  applyBlackboardScreenshotAction,
  reviseBlackboardScreenshotAction,
  applyAcademicCalendarAction,
  reviseAcademicCalendarAction,
} from "./school-ai-actions";
import {
  applyCourseImportAction,
  reviseCourseImportAction,
  rejectCourseImportAction,
} from "@/features/ai/course-import-actions";
import styles from "./school-intelligence-modal.module.css";

type TabMode = "schedule_image" | "blackboard_image" | "syllabus" | "academic_calendar";

type SchoolIntelligenceModalProps = {
  courses: CourseWithMeetings[];
  onClose: () => void;
};

export function SchoolIntelligenceModal({ courses, onClose }: SchoolIntelligenceModalProps) {
  const [tab, setTab] = useState<TabMode>("schedule_image");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, startApplyTransition] = useTransition();

  // Review states
  const [scheduleReview, setScheduleReview] = useState<ScheduleReview | null>(null);
  const [scheduleCourses, setScheduleCourses] = useState<ProposedCourseSchedule[]>([]);

  const [bbReview, setBbReview] = useState<BlackboardCourseReview | null>(null);
  const [bbCourses, setBbCourses] = useState<
    Array<ProposedBlackboardCourse & { action: "create" | "match" | "ignore"; targetCourseId?: string }>
  >([]);

  const [syllabusReview, setSyllabusReview] = useState<CourseImportReview | null>(null);
  const [syllabusProposal, setSyllabusProposal] = useState<CourseProposal | null>(null);

  const [calendarReview, setCalendarReview] = useState<AcademicCalendarReview | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<
    Array<ProposedAcademicEvent & { selected: boolean }>
  >([]);

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  function resetState() {
    controller.current?.abort();
    if (syllabusReview) void rejectCourseImportAction(syllabusReview.batchId);
    setScheduleReview(null);
    setScheduleCourses([]);
    setBbReview(null);
    setBbCourses([]);
    setSyllabusReview(null);
    setSyllabusProposal(null);
    setCalendarReview(null);
    setCalendarEvents([]);
    setError(null);
    setLoading(false);
  }

  function handleTabChange(nextTab: TabMode) {
    if (loading || applying) return;
    resetState();
    setTab(nextTab);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || loading) return;

    setLoading(true);
    setError(null);

    const abort = new AbortController();
    controller.current = abort;

    const formData = new FormData();
    formData.append("file", file);

    const companionConfig = getCompanionSession();
    const kind = tab === "syllabus" ? "course" : tab;

    try {
      const result = await generateRoutedProposal(kind, formData, companionConfig, abort.signal);

      if (abort.signal.aborted) return;

      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }

      const review = (result as { ok: true; review: unknown }).review;

      if (tab === "schedule_image") {
        const rev = review as ScheduleReview;
        setScheduleReview(rev);
        setScheduleCourses(rev.courses);
      } else if (tab === "blackboard_image") {
        const rev = review as BlackboardCourseReview;
        setBbReview(rev);
        setBbCourses(
          rev.courses.map((c) => {
            const matched = courses.find(
              (ex) =>
                ex.code.toLowerCase() === c.code.toLowerCase() ||
                ex.name.toLowerCase().includes(c.title.toLowerCase()),
            );
            return {
              ...c,
              action: matched ? "match" : "create",
              targetCourseId: matched?.id,
            };
          }),
        );
      } else if (tab === "syllabus") {
        const rev = review as CourseImportReview;
        setSyllabusReview(rev);
        setSyllabusProposal(rev.proposal);
      } else if (tab === "academic_calendar") {
        const rev = review as AcademicCalendarReview;
        setCalendarReview(rev);
        setCalendarEvents(rev.events.map((ev) => ({ ...ev, selected: true })));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process source.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  // Apply Handlers
  function handleApplySchedule() {
    if (!scheduleReview) return;
    startApplyTransition(async () => {
      try {
        let batchId = scheduleReview.batchId;
        const revised = await reviseScheduleImportAction(batchId, scheduleCourses);
        batchId = revised.batchId;
        const result = await applyScheduleImportAction(batchId);
        if (result.ok) onClose();
        else setError("Failed to apply class schedule.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply schedule.");
      }
    });
  }

  function handleApplyBlackboard() {
    if (!bbReview) return;
    startApplyTransition(async () => {
      try {
        let batchId = bbReview.batchId;
        const revised = await reviseBlackboardScreenshotAction(batchId, bbCourses);
        batchId = revised.batchId;
        const result = await applyBlackboardScreenshotAction(batchId);
        if (result.ok) onClose();
        else setError("Failed to apply Blackboard courses.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply courses.");
      }
    });
  }

  function handleApplySyllabus() {
    if (!syllabusReview) return;
    startApplyTransition(async () => {
      try {
        let batchId = syllabusReview.batchId;
        if (syllabusProposal) {
          const revised = await reviseCourseImportAction(batchId, syllabusProposal);
          if (revised.ok && revised.review) {
            batchId = revised.review.batchId;
          }
        }
        const result = await applyCourseImportAction(batchId);
        if (result.ok) onClose();
        else setError("Failed to apply syllabus.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply syllabus.");
      }
    });
  }

  function handleApplyCalendar() {
    if (!calendarReview) return;
    startApplyTransition(async () => {
      try {
        const approvedEvents = calendarEvents.filter((e) => e.selected);
        let batchId = calendarReview.batchId;
        const revised = await reviseAcademicCalendarAction(batchId, approvedEvents);
        batchId = revised.batchId;
        const result = await applyAcademicCalendarAction(batchId);
        if (result.ok) onClose();
        else setError("Failed to apply academic calendar events.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply calendar events.");
      }
    });
  }

  const hasActiveReview =
    Boolean(scheduleReview) ||
    Boolean(bbReview) ||
    Boolean(syllabusReview) ||
    Boolean(calendarReview);

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !applying) onClose();
      }}
    >
      <div className={`${styles.modal} motion-enter`} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>School Intelligence</p>
            <h3 className={styles.title}>Import Academic Schedule & Materials</h3>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={applying}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {!hasActiveReview ? (
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              className={styles.tab}
              data-active={tab === "schedule_image"}
              onClick={() => handleTabChange("schedule_image")}
            >
              <ImageIcon size={15} /> Class Schedule Screenshot
            </button>
            <button
              type="button"
              className={styles.tab}
              data-active={tab === "blackboard_image"}
              onClick={() => handleTabChange("blackboard_image")}
            >
              <GraduationCap size={15} /> Blackboard Screenshot
            </button>
            <button
              type="button"
              className={styles.tab}
              data-active={tab === "syllabus"}
              onClick={() => handleTabChange("syllabus")}
            >
              <FileText size={15} /> Course Syllabus
            </button>
            <button
              type="button"
              className={styles.tab}
              data-active={tab === "academic_calendar"}
              onClick={() => handleTabChange("academic_calendar")}
            >
              <Calendar size={15} /> Academic Calendar
            </button>
          </div>
        ) : null}

        <div className={styles.content}>
          {error ? (
            <div className={styles.errorBanner} role="alert">
              {error}
            </div>
          ) : null}

          {/* Upload Dropzone */}
          {!hasActiveReview ? (
            <div>
              <div
                className={styles.uploadBox}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                {loading ? (
                  <>
                    <Loader2 size={36} className={`${styles.uploadIcon} animate-spin`} />
                    <h4 className={styles.uploadHeadline}>Analyzing source with AI…</h4>
                    <p className={styles.uploadSubtext}>
                      Parsing structure, extracting items, and preparing review.
                    </p>
                  </>
                ) : (
                  <>
                    <FileUp size={36} className={styles.uploadIcon} />
                    <h4 className={styles.uploadHeadline}>
                      {tab === "schedule_image" && "Select Class Schedule Screenshot"}
                      {tab === "blackboard_image" && "Select Blackboard Courses Screenshot"}
                      {tab === "syllabus" && "Select Syllabus Document"}
                      {tab === "academic_calendar" && "Select Academic Calendar (Document or Screenshot)"}
                    </h4>
                    <p className={styles.uploadSubtext}>
                      {tab === "schedule_image" && "PNG, JPEG, WEBP up to 5MB. AI extracts courses and recurring meeting times."}
                      {tab === "blackboard_image" && "PNG, JPEG, WEBP up to 5MB. AI extracts course labels for deterministic mapping."}
                      {tab === "syllabus" && "PDF, DOCX, TXT, MD, ICS up to 10MB. AI extracts course details and timetable."}
                      {tab === "academic_calendar" && "ICS, CSV, TXT, PDF, DOCX or Screenshot. AI extracts term dates, breaks, and exam weeks."}
                    </p>
                  </>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                className={styles.fileInputHidden}
                aria-label="Upload source file"
                accept={
                  tab === "schedule_image" || tab === "blackboard_image"
                    ? "image/png,image/jpeg,image/webp"
                    : tab === "syllabus"
                    ? ".pdf,.docx,.txt,.md,.csv,.ics,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,text/calendar"
                    : ".pdf,.docx,.txt,.md,.csv,.ics,image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv,text/calendar"
                }
                onChange={handleFileChange}
                disabled={loading}
              />
            </div>
          ) : null}

          {/* Schedule Review Section */}
          {scheduleReview ? (
            <div className={styles.reviewSection}>
              <div className={styles.reviewHeader}>
                <h4 className={styles.reviewTitle}>Review Detected Schedule ({scheduleCourses.length} Courses)</h4>
                {scheduleReview.provenance ? (
                  <span className={styles.provenanceBadge}>
                    <Sparkles size={12} />
                    {scheduleReview.provenance.provider} · {scheduleReview.provenance.model} (
                    {scheduleReview.provenance.location})
                  </span>
                ) : null}
              </div>

              {scheduleCourses.map((c, idx) => (
                <div key={idx} className={styles.courseReviewCard}>
                  <div className={styles.courseHeaderRow}>
                    <input
                      className={styles.courseCodeInput}
                      value={c.code}
                      onChange={(e) => {
                        const updated = [...scheduleCourses];
                        updated[idx] = { ...updated[idx], code: e.target.value.toUpperCase() };
                        setScheduleCourses(updated);
                      }}
                      placeholder="CODE"
                      aria-label="Course Code"
                    />
                    <input
                      className={styles.courseTitleInput}
                      value={c.title}
                      onChange={(e) => {
                        const updated = [...scheduleCourses];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setScheduleCourses(updated);
                      }}
                      placeholder="Course Title"
                      aria-label="Course Title"
                    />
                    <button
                      type="button"
                      className={styles.closeButton}
                      onClick={() => {
                        setScheduleCourses(scheduleCourses.filter((_, i) => i !== idx));
                      }}
                      aria-label="Remove course"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <ul className={styles.meetingList}>
                    {c.meetings.map((m, mIdx) => (
                      <li key={mIdx} className={styles.meetingRow}>
                        <span className={styles.meetingWeekday}>{m.weekday}</span>
                        <span className={styles.meetingTime}>
                          {m.startTime} – {m.endTime}
                        </span>
                        {m.room ? <span>{m.room}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {/* Blackboard Review Section */}
          {bbReview ? (
            <div className={styles.reviewSection}>
              <div className={styles.reviewHeader}>
                <h4 className={styles.reviewTitle}>Review Blackboard Courses ({bbCourses.length} Found)</h4>
                {bbReview.provenance ? (
                  <span className={styles.provenanceBadge}>
                    <Sparkles size={12} />
                    {bbReview.provenance.provider} · {bbReview.provenance.model}
                  </span>
                ) : null}
              </div>

              {bbCourses.map((c, idx) => (
                <div key={idx} className={styles.courseReviewCard}>
                  <div className={styles.courseHeaderRow}>
                    <strong style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>{c.code}</strong>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", flex: 1 }}>
                      {c.title}
                    </span>
                    <select
                      className={styles.courseCodeInput}
                      style={{ width: "auto" }}
                      value={c.action}
                      onChange={(e) => {
                        const updated = [...bbCourses];
                        updated[idx] = {
                          ...updated[idx],
                          action: e.target.value as "create" | "match" | "ignore",
                        };
                        setBbCourses(updated);
                      }}
                    >
                      <option value="create">Create new course</option>
                      <option value="match">Match existing</option>
                      <option value="ignore">Ignore</option>
                    </select>
                  </div>

                  {c.action === "match" ? (
                    <select
                      className={styles.courseTitleInput}
                      value={c.targetCourseId || ""}
                      onChange={(e) => {
                        const updated = [...bbCourses];
                        updated[idx] = { ...updated[idx], targetCourseId: e.target.value };
                        setBbCourses(updated);
                      }}
                    >
                      <option value="">Select existing course to match…</option>
                      {courses.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.code} · {ex.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* Syllabus Review Section */}
          {syllabusReview && syllabusProposal ? (
            <div className={styles.reviewSection}>
              <div className={styles.reviewHeader}>
                <h4 className={styles.reviewTitle}>Review Syllabus Proposal</h4>
                {syllabusReview.provenance ? (
                  <span className={styles.provenanceBadge}>
                    <Sparkles size={12} />
                    {syllabusReview.provenance.provider} · {syllabusReview.provenance.model}
                  </span>
                ) : null}
              </div>

              <div className={styles.courseReviewCard}>
                <div className={styles.courseHeaderRow}>
                  <input
                    className={styles.courseCodeInput}
                    value={syllabusProposal.code}
                    onChange={(e) =>
                      setSyllabusProposal({ ...syllabusProposal, code: e.target.value.toUpperCase() })
                    }
                    placeholder="CODE"
                  />
                  <input
                    className={styles.courseTitleInput}
                    value={syllabusProposal.name}
                    onChange={(e) =>
                      setSyllabusProposal({ ...syllabusProposal, name: e.target.value })
                    }
                    placeholder="Course Title"
                  />
                </div>

                <ul className={styles.meetingList}>
                  {syllabusProposal.meetings.map((m, mIdx) => (
                    <li key={mIdx} className={styles.meetingRow}>
                      <span className={styles.meetingWeekday}>{m.title}</span>
                      <span className={styles.meetingTime}>
                        {m.startTime} – {m.endTime}
                      </span>
                      {m.location ? <span>{m.location}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {/* Academic Calendar Review Section */}
          {calendarReview ? (
            <div className={styles.reviewSection}>
              <div className={styles.reviewHeader}>
                <h4 className={styles.reviewTitle}>Review Academic Dates ({calendarEvents.length} Events)</h4>
                {calendarReview.provenance ? (
                  <span className={styles.provenanceBadge}>
                    <Sparkles size={12} />
                    {calendarReview.provenance.provider} · {calendarReview.provenance.model}
                  </span>
                ) : null}
              </div>

              {calendarEvents.map((ev, idx) => (
                <div key={idx} className={styles.eventRow}>
                  <input
                    type="checkbox"
                    className={styles.eventCheckbox}
                    checked={ev.selected}
                    onChange={(e) => {
                      const updated = [...calendarEvents];
                      updated[idx] = { ...updated[idx], selected: e.target.checked };
                      setCalendarEvents(updated);
                    }}
                  />
                  <span className={styles.eventTitle}>{ev.title}</span>
                  <span className={styles.eventTypeBadge}>{ev.eventType}</span>
                  <span className={styles.eventDate}>{ev.startDate}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {hasActiveReview ? (
          <div className={styles.footer}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={resetState}
              disabled={applying}
            >
              Reset & Choose Other File
            </button>

            <div className={styles.footerActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
                disabled={applying}
              >
                Cancel
              </button>

              <button
                type="button"
                className={styles.primaryButton}
                disabled={applying}
                onClick={() => {
                  if (scheduleReview) handleApplySchedule();
                  else if (bbReview) handleApplyBlackboard();
                  else if (syllabusReview) handleApplySyllabus();
                  else if (calendarReview) handleApplyCalendar();
                }}
              >
                {applying ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                <span>
                  {applying
                    ? "Applying to School…"
                    : scheduleReview
                    ? "Approve & Create Courses"
                    : bbReview
                    ? "Approve Course Mappings"
                    : syllabusReview
                    ? "Approve & Create Course"
                    : "Import Academic Events"}
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
