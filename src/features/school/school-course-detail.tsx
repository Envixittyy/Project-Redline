"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  ExternalLink,
  FileText,
  Megaphone,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import type { CourseMaterial } from "@/types/course-material";
import type { SchoolEmailEvent, SchoolItem } from "@/types/school-item";
import { courseMaterialTypes } from "@/types/course-material";
import { archiveCourseAction, deleteMeetingAction, saveMeetingAction } from "./school-actions";
import { deleteCourseMaterialAction, saveCourseMaterialAction } from "./school-material-actions";
import { SchoolUpcomingWork } from "./school-upcoming-work";
import { SchoolActivityFeed } from "./school-activity-feed";
import { CoursePredictionsPanel } from "./course-predictions-panel";
import { CourseMaterialIntelligenceModal } from "./course-material-intelligence-modal";
import { ContextualAssistantModal } from "@/features/ai/contextual-assistant-modal";
import { schoolEventBelongsToCourse } from "./school-ui-domain";
import styles from "./school-course-detail.module.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SchoolCourseDetailProps = {
  course: CourseWithMeetings;
  allCourses: CourseWithMeetings[];
  items: SchoolItem[];
  materials: CourseMaterial[];
  events: SchoolEmailEvent[];
  today: string;
  timeZone: string;
  onBack: () => void;
};

export function SchoolCourseDetail({
  course,
  allCourses,
  items,
  materials,
  events,
  today,
  timeZone,
  onBack,
}: SchoolCourseDetailProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [aiStudyMaterials, setAiStudyMaterials] = useState<CourseMaterial[] | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);

  const courseItems = items.filter((i) => i.courseId === course.id);
  const courseMaterials = materials.filter((m) => m.courseId === course.id);
  const bbMaterials = courseItems.filter((i) => i.itemType === "material");
  const bbAnnouncements = courseItems.filter((i) => i.itemType === "announcement");

  // Events related to this course
  const courseEvents = events.filter((event) => schoolEventBelongsToCourse(event, course.id));

  const run = (
    work: () => Promise<{ ok: true; message?: string } | { ok: false; message: string }>,
    done?: () => void,
  ) => {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setError(null);
        done?.();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.backButton}
        onClick={onBack}
        aria-label="Back to School Overview"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Back to School Overview</span>
      </button>

      {error ? (
        <div style={{ padding: "0.75rem", borderRadius: "var(--radius-md)", background: "color-mix(in oklch, var(--destructive) 15%, transparent)", color: "var(--destructive)" }}>
          {error}
        </div>
      ) : null}

      {/* Course Header */}
      <div className={styles.courseHeader}>
        <div className={styles.courseInfo}>
          <span
            className={styles.swatch}
            style={{ backgroundColor: course.color ?? "var(--accent)" }}
            aria-hidden="true"
          />
          <div className={styles.courseMeta}>
            <p className={styles.courseCode}>{course.code}</p>
            <h2>{course.name}</h2>
            <p className={styles.courseDetails}>
              {[course.instructor, course.location].filter(Boolean).join(" · ") ||
                "No instructor or location set"}
            </p>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={() => setShowMeetingForm((v) => !v)}
            aria-expanded={showMeetingForm}
          >
            <CalendarPlus size={15} aria-hidden="true" />
            <span>Meeting</span>
          </button>
          <button
            type="button"
            onClick={() => setShowMaterialForm((v) => !v)}
            aria-expanded={showMaterialForm}
          >
            <FileText size={15} aria-hidden="true" />
            <span>Material</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAssistant(true)}
            aria-label={`AI Assistant for ${course.code}`}
          >
            <Sparkles size={15} aria-hidden="true" />
            <span>AI Assistant</span>
          </button>
          <button
            type="button"
            onClick={() => run(() => archiveCourseAction(course.id), onBack)}
            style={{ color: "var(--text-muted)" }}
          >
            Archive
          </button>
        </div>
      </div>

      {/* Meeting Form */}
      {showMeetingForm ? (
        <form
          className={styles.meetingForm}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(
              () =>
                saveMeetingAction(null, {
                  courseId: course.id,
                  title: String(data.get("title")),
                  weekdays: data.getAll("weekdays").map(Number),
                  startDate: String(data.get("startDate")),
                  endDateExclusive: String(data.get("endDate")),
                  startTime: String(data.get("startTime")),
                  endTime: String(data.get("endTime")),
                  timeZone,
                  location: String(data.get("location")),
                }),
              () => setShowMeetingForm(false),
            );
          }}
        >
          <label>
            Meeting title
            <input name="title" defaultValue="Lecture" required />
          </label>
          <fieldset>
            <legend>Days</legend>
            {weekdays.map((day, index) => (
              <label key={day}>
                <input type="checkbox" name="weekdays" value={index} />
                {day}
              </label>
            ))}
          </fieldset>
          <div className={styles.formGrid}>
            <label>
              Starts
              <input type="date" name="startDate" defaultValue={today} required />
            </label>
            <label>
              Ends (optional)
              <input type="date" name="endDate" />
            </label>
            <label>
              Start time
              <input type="time" name="startTime" defaultValue="10:00" required />
            </label>
            <label>
              End time
              <input type="time" name="endTime" defaultValue="11:30" required />
            </label>
            <label>
              Room / Location
              <input name="location" placeholder={course.location ?? "Room 101"} />
            </label>
          </div>
          <button disabled={pending} type="submit">
            {pending ? "Saving..." : "Save meeting"}
          </button>
        </form>
      ) : null}

      {/* Material Form */}
      {showMaterialForm ? (
        <form
          className={styles.materialForm}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(
              () =>
                saveCourseMaterialAction(course.id, null, {
                  title: String(data.get("title")),
                  type: String(data.get("type")),
                  url: String(data.get("url")),
                  description: String(data.get("description")),
                }),
              () => setShowMaterialForm(false),
            );
          }}
        >
          <label>
            Material Title
            <input
              name="title"
              maxLength={200}
              placeholder="e.g. Week 1 Lecture Slides / Syllabus"
              required
            />
          </label>
          <div className={styles.formGrid}>
            <label>
              Type
              <select name="type" defaultValue="document">
                {courseMaterialTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Resource URL / File Link (Optional)
              <input
                name="url"
                type="url"
                placeholder="https://..."
              />
            </label>
          </div>
          <label>
            Description / Notes (Optional)
            <textarea
              name="description"
              rows={2}
              placeholder="Key concepts or instructions..."
            />
          </label>
          <button disabled={pending} type="submit">
            {pending ? "Saving..." : "Save material"}
          </button>
        </form>
      ) : null}

      {/* 1. Upcoming Work */}
      <SchoolUpcomingWork
        items={courseItems}
        courses={allCourses}
        today={today}
        timeZone={timeZone}
        title={`Upcoming Work for ${course.code}`}
      />

      {/* 2. Course Materials (both uploaded and Blackboard) */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <span>Course Materials</span>
            <span className={styles.badge}>
              {courseMaterials.length + bbMaterials.length}
            </span>
          </h3>
          {courseMaterials.length > 0 ? (
            <button
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                background: "transparent",
                border: "none",
                color: "var(--accent-text)",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
              onClick={() => setAiStudyMaterials(courseMaterials)}
            >
              <Sparkles size={13} />
              <span>Study & Summarize</span>
            </button>
          ) : null}
        </div>

        {courseMaterials.length === 0 && bbMaterials.length === 0 ? (
          <div className={styles.emptyState}>
            No syllabus, readings, or slides attached to this course yet.
          </div>
        ) : (
          <ul className={styles.resourceList}>
            {/* Blackboard Ingested Materials */}
            {bbMaterials.map((bbMat) => (
              <li key={bbMat.id} className={styles.resourceCard}>
                <div className={styles.resourceBody}>
                  <div className={styles.resourceTitleLine}>
                    <span className={styles.typeBadge}>Blackboard Material</span>
                    <span className={styles.resourceTitle}>{bbMat.title}</span>
                  </div>
                  {bbMat.sourceUrl ? (
                    <a
                      href={bbMat.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.resourceLink}
                    >
                      <span>Open in Blackboard</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}

            {/* Custom Uploaded Course Materials */}
            {courseMaterials.map((mat) => (
              <li key={mat.id} className={styles.resourceCard}>
                <div className={styles.resourceBody}>
                  <div className={styles.resourceTitleLine}>
                    <span className={styles.typeBadge}>{mat.type}</span>
                    <span className={styles.resourceTitle}>{mat.title}</span>
                  </div>
                  {mat.url ? (
                    <a
                      href={mat.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.resourceLink}
                    >
                      <span>Open resource</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                  {mat.description ? (
                    <p className={styles.resourceDescription}>{mat.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => run(() => deleteCourseMaterialAction(mat.id))}
                  aria-label={`Delete ${mat.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 3. Course Announcements */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <span>Announcements</span>
            <span className={styles.badge}>{bbAnnouncements.length}</span>
          </h3>
        </div>

        {bbAnnouncements.length === 0 ? (
          <div className={styles.emptyState}>
            No announcements posted for this course.
          </div>
        ) : (
          <ul className={styles.resourceList}>
            {bbAnnouncements.map((ann) => (
              <li key={ann.id} className={styles.resourceCard}>
                <div className={styles.resourceBody}>
                  <div className={styles.resourceTitleLine}>
                    <Megaphone size={14} style={{ color: "var(--text-secondary)" }} aria-hidden="true" />
                    <span className={styles.resourceTitle}>{ann.title}</span>
                  </div>
                  {ann.sourceUrl ? (
                    <a
                      href={ann.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.resourceLink}
                    >
                      <span>Open in Blackboard</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 4. Weekly Timetable Meetings */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            <span>Weekly Timetable</span>
            <span className={styles.badge}>{course.meetings.length}</span>
          </h3>
        </div>

        {course.meetings.length === 0 ? (
          <div className={styles.emptyState}>
            No weekly meetings scheduled.
          </div>
        ) : (
          <ul className={styles.resourceList}>
            {course.meetings.map((meeting) => (
              <li key={meeting.id} className={styles.resourceCard}>
                <div className={styles.resourceBody}>
                  <div className={styles.resourceTitleLine}>
                    <span className={styles.resourceTitle}>{meeting.title}</span>
                  </div>
                  <p className={styles.resourceDescription}>
                    {meeting.weekdays.map((day) => weekdays[day]).join(", ")} · {meeting.startTime}–{meeting.endTime}
                    {meeting.location ? ` · ${meeting.location}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => run(() => deleteMeetingAction(meeting.id))}
                  aria-label={`Delete ${meeting.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 5. Predictions Panel */}
      <CoursePredictionsPanel
        courseId={course.id}
        courseCode={course.code}
      />

      {/* 6. Recent Blackboard Activity for this Course */}
      <SchoolActivityFeed
        events={courseEvents}
        courses={allCourses}
        timeZone={timeZone}
        title={`Recent Blackboard Activity for ${course.code}`}
      />

      {/* AI Modals */}
      {aiStudyMaterials ? (
        <CourseMaterialIntelligenceModal
          materials={aiStudyMaterials.map((m) => ({
            id: m.id,
            title: m.title,
            materialType: m.type,
          }))}
          onClose={() => setAiStudyMaterials(null)}
        />
      ) : null}

      {showAssistant ? (
        <ContextualAssistantModal
          entityType="course"
          entityId={course.id}
          entityTitle={`${course.code} - ${course.name}`}
          onClose={() => setShowAssistant(false)}
        />
      ) : null}
    </div>
  );
}
