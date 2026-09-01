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
  const [scheduleCourses, setScheduleCourses] = useState<ScheduleEdit[]>([]);

  const [bbReview, setBbReview] = useState<BlackboardCourseReview | null>(null);
  const [bbCourses, setBbCourses] = useState<BlackboardCourseEdit[]>([]);

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
        setScheduleCourses(rev.courses.map(({ targetFingerprint: _fingerprint, ...course }) => course));
      } else if (tab === "blackboard_image") {
        const rev = review as BlackboardCourseReview;
        setBbReview(rev);
        setBbCourses(rev.courses.map(({ targetFingerprint: _fingerprint, ...course }) => course));
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
          } else {
            setError("Could not save your edits for review. Nothing was applied.");
            return;
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
  const screenshotReviewReady = scheduleReview
    ? scheduleCourses.every((course) => course.decision === "IGNORE" || (
        course.code.trim().length > 0 && course.name.trim().length > 0 && course.meetings.length > 0 &&
        course.meetings.every((meeting) => Boolean(meeting.endTime)) &&
        (course.decision !== "MATCH_EXISTING" || Boolean(course.targetCourseId))))
    : bbReview
    ? bbCourses.every((course) => course.decision === "IGNORE" || (
        course.decision === "MATCH_EXISTING" ? Boolean(course.targetCourseId) : Boolean(course.code?.trim() && course.title?.trim())))
    : true;

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
              disabled
              title="Academic Calendar import remains disabled pending its dedicated trust pass."
            >
              <Calendar size={15} /> Academic Calendar (Unavailable)
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
                      {tab === "academic_calendar" && "Academic Calendar import is unavailable"}
                    </h4>
                    <p className={styles.uploadSubtext}>
                      {tab === "schedule_image" && "PNG, JPEG, WEBP up to 5MB. AI extracts courses and recurring meeting times."}
                      {tab === "blackboard_image" && "PNG, JPEG, WEBP up to 5MB. AI extracts visible labels for Course review only; it cannot establish Blackboard identity."}
                      {tab === "syllabus" && "PDF, DOCX, TXT, MD, ICS up to 10MB. AI extracts course details and timetable."}
                      {tab === "academic_calendar" && "This workflow remains disabled pending its dedicated identity and divergence design."}
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

                  <div className={styles.courseHeaderRow}>
                    <select
                      className={styles.courseTitleInput}
                      value={c.decision}
                      onChange={(e) => {
                        const decision = e.target.value as ScheduleEdit["decision"];
                        const updated = [...scheduleCourses];
                        updated[idx] = { ...updated[idx], decision, ...(decision === "MATCH_EXISTING" ? {} : { targetCourseId: undefined }) };
                        setScheduleCourses(updated);
                      }}
                    >
                      <option value="IGNORE">Ignore</option>
                      <option value="CREATE_NEW">Create new Course</option>
                      <option value="MATCH_EXISTING">Match existing Course</option>
                    </select>
                    {c.decision === "MATCH_EXISTING" ? (
                      <select className={styles.courseTitleInput} value={c.targetCourseId ?? ""} onChange={(e) => {
                        const updated = [...scheduleCourses]; updated[idx] = { ...updated[idx], targetCourseId: e.target.value }; setScheduleCourses(updated);
                      }}>
                        <option value="">Select exact Course…</option>
                        {courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}
                      </select>
                    ) : null}
                  </div>

                  <ul className={styles.meetingList}>
                    {c.meetings.map((m, mIdx) => (
                      <li key={mIdx} className={styles.meetingRow}>
                        <select value={m.weekday} aria-label="Meeting weekday" onChange={(e) => { const updated=[...scheduleCourses]; const meetings=[...updated[idx].meetings]; meetings[mIdx]={...meetings[mIdx],weekday:e.target.value as typeof m.weekday}; updated[idx]={...updated[idx],meetings}; setScheduleCourses(updated); }}>
                          {(["sunday","monday","tuesday","wednesday","thursday","friday","saturday"] as const).map(day => <option key={day} value={day}>{day}</option>)}
                        </select>
                        <input type="time" value={m.startTime} aria-label="Meeting start time" onChange={(e) => { const updated=[...scheduleCourses]; const meetings=[...updated[idx].meetings]; meetings[mIdx]={...meetings[mIdx],startTime:e.target.value}; updated[idx]={...updated[idx],meetings}; setScheduleCourses(updated); }} />
                        <input type="time" value={m.endTime ?? ""} aria-label="Meeting end time" onChange={(e) => { const updated=[...scheduleCourses]; const meetings=[...updated[idx].meetings]; meetings[mIdx]={...meetings[mIdx],...(e.target.value ? {endTime:e.target.value} : {endTime:undefined})}; updated[idx]={...updated[idx],meetings}; setScheduleCourses(updated); }} />
                        <input value={m.room ?? ""} placeholder="Room (optional)" aria-label="Meeting room" onChange={(e) => { const updated=[...scheduleCourses]; const meetings=[...updated[idx].meetings]; meetings[mIdx]={...meetings[mIdx],...(e.target.value ? {room:e.target.value} : {room:undefined})}; updated[idx]={...updated[idx],meetings}; setScheduleCourses(updated); }} />
                        <button type="button" className={styles.closeButton} aria-label="Remove meeting" onClick={() => { const updated=[...scheduleCourses]; updated[idx]={...updated[idx],meetings:updated[idx].meetings.filter((_,i)=>i!==mIdx)}; setScheduleCourses(updated); }}><Trash2 size={13}/></button>
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
                    <input className={styles.courseCodeInput} value={c.code ?? ""} placeholder="Visible code" onChange={(e) => { const updated=[...bbCourses]; updated[idx]={...updated[idx],...(e.target.value ? {code:e.target.value} : {code:undefined})}; setBbCourses(updated); }} />
                    <input className={styles.courseTitleInput} value={c.title ?? ""} placeholder="Visible Course title" onChange={(e) => { const updated=[...bbCourses]; updated[idx]={...updated[idx],...(e.target.value ? {title:e.target.value} : {title:undefined})}; setBbCourses(updated); }} />
                    <select
                      className={styles.courseCodeInput}
                      style={{ width: "auto" }}
                      value={c.decision}
                      onChange={(e) => {
                        const updated = [...bbCourses];
                        updated[idx] = {
                          ...updated[idx],
                          decision: e.target.value as BlackboardCourseEdit["decision"],
                          ...(e.target.value === "MATCH_EXISTING" ? {} : { targetCourseId: undefined }),
                        };
                        setBbCourses(updated);
                      }}
                    >
                      <option value="IGNORE">Ignore</option>
                      <option value="CREATE_NEW">Create new Course</option>
                      <option value="MATCH_EXISTING">Match existing Course</option>
                    </select>
                  </div>

                  <p className={styles.uploadSubtext}>{c.sourceLabel}</p>
                  {c.decision === "MATCH_EXISTING" ? (
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
                disabled={applying || !screenshotReviewReady}
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
                    ? "Approve Schedule Import"
                    : bbReview
                    ? "Approve Course Bootstrap"
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
