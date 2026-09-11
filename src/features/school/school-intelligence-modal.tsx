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
  ScheduleEdit,
} from "@/services/integrations/ai/school-schedule-contract";
import type {
  BlackboardCourseReview,
  BlackboardCourseEdit,
} from "@/services/integrations/ai/blackboard-screenshot-contract";
import type {
  AcademicCalendarReview,
  AcademicCalendarEdit,
  AcademicCalendarDecision,
} from "@/services/integrations/ai/academic-calendar-contract";
import type { CourseImportReview, CourseProposal } from "@/services/integrations/ai/course-import-contract";
import {
  applyScheduleImportAction,
  reviseScheduleImportAction,
  applyBlackboardScreenshotAction,
  reviseBlackboardScreenshotAction,
  applyAcademicCalendarAction,
  prepareDeterministicAcademicCalendarImportAction,
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
  const [scheduleCourses, setScheduleCourses] = useState<ScheduleEdit[]>([]);

  const [bbReview, setBbReview] = useState<BlackboardCourseReview | null>(null);
  const [bbCourses, setBbCourses] = useState<
    Array<BlackboardCourseEdit & { action: "create" | "match" | "ignore" }>
  >([]);

  const [syllabusReview, setSyllabusReview] = useState<CourseImportReview | null>(null);
  const [syllabusProposal, setSyllabusProposal] = useState<CourseProposal | null>(null);

  const [calendarReview, setCalendarReview] = useState<AcademicCalendarReview | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<
    Array<AcademicCalendarEdit & { selected: boolean; offDecision: AcademicCalendarDecision }>
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
    formData.append("sourceLabel", file.name);

    const companionConfig = getCompanionSession();
    const kind = tab === "syllabus" ? "course" : tab;

    try {
      const deterministicCalendar = tab === "academic_calendar" && /\.(ics|csv)$/i.test(file.name);
      const result = deterministicCalendar
        ? { ok: true as const, review: await prepareDeterministicAcademicCalendarImportAction(formData) }
        : await generateRoutedProposal(kind, formData, companionConfig, abort.signal);

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
        setScheduleCourses(rev.courses.map((course) => {
          const match = courses.find((existing) => existing.code.toLowerCase() === course.code.toLowerCase());
          return { code: course.code, name: course.name, meetings: course.meetings,
            decision: match ? "MATCH_EXISTING" : "CREATE_NEW", ...(match ? { targetCourseId: match.id } : {}) };
        }));
      } else if (tab === "blackboard_image") {
        const rev = review as BlackboardCourseReview;
        setBbReview(rev);
        setBbCourses(
          rev.courses.map((c) => {
            const matched = courses.find(
              (ex) =>
                (c.code ? ex.code.toLowerCase() === c.code.toLowerCase() : false) ||
                (c.title ? ex.name.toLowerCase().includes(c.title.toLowerCase()) : false),
            );
            return {
              sourceLabel: c.sourceLabel,
              ...(c.code ? { code: c.code } : {}),
              ...(c.title ? { title: c.title } : {}),
              decision: matched ? "MATCH_EXISTING" : "CREATE_NEW",
              action: matched ? "match" : "create",
              ...(matched ? { targetCourseId: matched.id } : {}),
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
        setCalendarEvents(rev.events.map((item) => ({
          entryId: item.entryId,
          decision: item.decision,
          event: item.reviewed,
          selected: item.decision === "APPLY" || item.decision === "APPLY_SOURCE",
          offDecision: item.operation === "CREATE" ? "IGNORE" : "KEEP_CURRENT",
        })));
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
        const persisted = scheduleReview.courses.map(({ targetFingerprint: _fingerprint, ...course }) => course);
        if (JSON.stringify(scheduleCourses) !== JSON.stringify(persisted)) {
          const revised = await reviseScheduleImportAction(scheduleReview.batchId, scheduleCourses);
          setScheduleReview(revised);
          setScheduleCourses(revised.courses.map(({ targetFingerprint: _fingerprint, ...course }) => course));
          setError("Edits saved as a new review. Check them once more, then approve separately.");
          return;
        }
        const result = await applyScheduleImportAction(scheduleReview.batchId);
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
        const edits: BlackboardCourseEdit[] = bbCourses.map((course) => {
          const { action, ...input } = course;
          return {
            ...input,
            decision: action === "match" ? "MATCH_EXISTING" : action === "create" ? "CREATE_NEW" : "IGNORE",
            ...(action !== "match" ? { targetCourseId: undefined } : {}),
          };
        });
        const persisted = bbReview.courses.map(({ targetFingerprint: _fingerprint, ...course }) => course);
        if (JSON.stringify(edits) !== JSON.stringify(persisted)) {
          const revised = await reviseBlackboardScreenshotAction(bbReview.batchId, edits);
          setBbReview(revised);
          setBbCourses(revised.courses.map(({ targetFingerprint: _fingerprint, ...course }) => ({
            ...course,
            action: course.decision === "MATCH_EXISTING" ? "match" : course.decision === "CREATE_NEW" ? "create" : "ignore",
          })));
          setError("Edits saved as a new review. Check them once more, then approve separately.");
          return;
        }
        const result = await applyBlackboardScreenshotAction(bbReview.batchId);
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
        if (syllabusProposal && JSON.stringify(syllabusProposal) !== JSON.stringify(syllabusReview.proposal)) {
          const revised = await reviseCourseImportAction(syllabusReview.batchId, syllabusProposal);
          if (revised.ok && revised.review) {
            setSyllabusReview(revised.review);
            setSyllabusProposal(revised.review.proposal);
            setError("Edits saved as a new review. Check them once more, then approve separately.");
            return;
          }
        }
        const result = await applyCourseImportAction(syllabusReview.batchId);
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
        const edits = calendarEvents.map(({ selected: _selected, offDecision: _off, ...edit }) => edit);
        const persisted = calendarReview.events.map((item) => ({ entryId: item.entryId, decision: item.decision, event: item.reviewed }));
        if (JSON.stringify(edits) !== JSON.stringify(persisted)) {
          const revised = await reviseAcademicCalendarAction(calendarReview.batchId, edits);
          setCalendarReview(revised);
          setCalendarEvents(revised.events.map((item) => ({ entryId: item.entryId, decision: item.decision, event: item.reviewed,
            selected: item.decision === "APPLY" || item.decision === "APPLY_SOURCE",
            offDecision: item.operation === "CREATE" ? "IGNORE" : "KEEP_CURRENT" })));
          setError("Edits saved as a new review. Check them once more, then approve separately.");
          return;
        }
        const result = await applyAcademicCalendarAction(calendarReview.batchId);
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
                      value={c.name}
                      onChange={(e) => {
                        const updated = [...scheduleCourses];
                        updated[idx] = { ...updated[idx], name: e.target.value };
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
                    <strong style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>{c.code ?? "Course"}</strong>
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
                      updated[idx] = {
                        ...updated[idx],
                        selected: e.target.checked,
                        decision: e.target.checked ? "APPLY" : updated[idx].offDecision,
                      };
                      setCalendarEvents(updated);
                    }}
                  />
                  <span className={styles.eventTitle}>{ev.event.title}</span>
                  <span className={styles.eventTypeBadge}>{ev.event.eventType}</span>
                  <span className={styles.eventDate}>{ev.event.start}</span>
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
