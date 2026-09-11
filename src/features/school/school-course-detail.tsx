"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Clock,
  ExternalLink,
  FilePlus,
  FolderOpen,
  MapPin,
  Megaphone,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import type { CourseWithMeetings, PersistedCourseMeeting } from "@/types/course";
import type { CourseMaterial } from "@/types/course-material";
import type { SchoolEmailEvent, SchoolItem } from "@/types/school-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentOption } from "@/components/ui/segmented-control";
import { useCourseAccent } from "@/components/shell/ambient-context";
import { ContextualAssistantModal } from "@/features/ai/contextual-assistant-modal";
import { archiveCourseAction, deleteMeetingAction } from "./school-actions";
import { deleteCourseMaterialAction } from "./school-material-actions";
import { SchoolUpcomingWork } from "./school-upcoming-work";
import { SchoolActivityFeed } from "./school-activity-feed";
import { CoursePredictionsPanel } from "./course-predictions-panel";
import { CourseMaterialIntelligenceModal } from "./course-material-intelligence-modal";
import { MeetingFormModal } from "./meeting-form-modal";
import { MaterialFormModal } from "./material-form-modal";
import { schoolEventBelongsToCourse } from "./school-ui-domain";
import styles from "./school-course-detail.module.css";

const weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CourseTab = "overview" | "materials" | "intelligence";

const tabOptions: Array<SegmentOption<CourseTab>> = [
  { value: "overview", label: "Overview & Work" },
  { value: "materials", label: "Materials & Notes" },
  { value: "intelligence", label: "Intelligence & Activity" },
];

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
  // Apply restrained ambient course accent
  useCourseAccent(course.color ?? undefined);

  const [activeTab, setActiveTab] = useState<CourseTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Modals
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<PersistedCourseMeeting | null>(null);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [aiStudyMaterials, setAiStudyMaterials] = useState<CourseMaterial[] | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);

  // Filter items for this course
  const courseItems = items.filter((i) => i.courseId === course.id);
  const courseMaterials = materials.filter((m) => m.courseId === course.id);
  const bbMaterials = courseItems.filter((i) => i.itemType === "material");
  const bbAnnouncements = courseItems.filter((i) => i.itemType === "announcement");

  // Filter email events for this course using the canonical domain function
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

  function handleArchive() {
    if (window.confirm(`Are you sure you want to archive ${course.code}?`)) {
      run(() => archiveCourseAction(course.id), onBack);
    }
  }

  return (
    <div className={styles.container}>
      {/* Top navigation bar */}
      <div className={styles.topBar}>
        <Button variant="secondary" size="sm" onClick={onBack} aria-label="Back to School Overview">
          <ArrowLeft size={15} aria-hidden="true" />
          <span>Back to School</span>
        </Button>
      </div>

      {error ? (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      ) : null}

      {/* Course Header Banner */}
      <div
        className={styles.courseHeader}
        style={
          {
            "--course-accent": course.color ?? "var(--accent)",
          } as React.CSSProperties
        }
      >
        <div className={styles.courseIdentity}>
          <div className={styles.codeBadgeRow}>
            <Badge variant="subtle" size="sm">
              {course.code}
            </Badge>
            {course.meetings.length > 0 ? (
              <Badge variant="outline" size="sm">
                {course.meetings.length} {course.meetings.length === 1 ? "meeting" : "meetings"}/week
              </Badge>
            ) : null}
          </div>

          <h2 className={styles.courseTitle}>{course.name}</h2>

          <div className={styles.courseMetaRow}>
            {course.instructor ? (
              <span className={styles.metaItem}>
                <User size={13} aria-hidden="true" />
                <span>{course.instructor}</span>
              </span>
            ) : null}
            {course.location ? (
              <span className={styles.metaItem}>
                <MapPin size={13} aria-hidden="true" />
                <span>{course.location}</span>
              </span>
            ) : null}
          </div>
        </div>

        {/* Action buttons */}
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditingMeeting(null);
              setShowMeetingModal(true);
            }}
          >
            <CalendarPlus size={14} aria-hidden="true" />
            <span>+ Meeting</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowMaterialModal(true)}
          >
            <FilePlus size={14} aria-hidden="true" />
            <span>+ Material</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAssistant(true)}
            aria-label={`AI Study Assistant for ${course.code}`}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>AI Assistant</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleArchive}
            disabled={pending}
            style={{ color: "var(--text-tertiary)" }}
          >
            Archive
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabNavigation}>
        <SegmentedControl
          options={tabOptions}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Course sections"
        />
      </div>

      {/* Tab 1: Overview & Work */}
      {activeTab === "overview" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Upcoming Work */}
          <SchoolUpcomingWork
            items={courseItems}
            courses={allCourses}
            today={today}
            timeZone={timeZone}
            title={`Upcoming Work for ${course.code}`}
          />

          {/* Weekly Meetings List */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Calendar size={14} aria-hidden="true" />
                <span>Weekly Meetings</span>
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingMeeting(null);
                  setShowMeetingModal(true);
                }}
              >
                + Add meeting
              </Button>
            </div>

            {course.meetings.length === 0 ? (
              <div className={styles.emptyState}>
                No regular class meetings scheduled yet. Add recurring lectures or labs.
              </div>
            ) : (
              <ul className={styles.resourceList}>
                {course.meetings.map((meeting) => (
                  <li key={meeting.id} className={styles.resourceCard}>
                    <div className={styles.resourceBody}>
                      <div className={styles.resourceTitleLine}>
                        <span className={styles.resourceTitle}>{meeting.title}</span>
                        <Badge variant="subtle" size="sm">
                          {meeting.weekdays.map((d) => weekdaysShort[d]).join(", ")}
                        </Badge>
                      </div>
                      <p className={styles.resourceDescription}>
                        <Clock size={12} style={{ display: "inline", marginRight: "0.25rem" }} />
                        {meeting.startTime} – {meeting.endTime}
                        {meeting.location ? ` · ${meeting.location}` : ""}
                      </p>
                    </div>

                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => run(() => deleteMeetingAction(meeting.id))}
                      aria-label={`Delete ${meeting.title}`}
                      title="Delete meeting"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Tab 2: Materials & Notes */}
      {activeTab === "materials" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Course Materials */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <FolderOpen size={14} aria-hidden="true" />
                <span>Course Materials</span>
                <Badge variant="subtle" size="sm">
                  {courseMaterials.length + bbMaterials.length}
                </Badge>
              </h3>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                {courseMaterials.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAiStudyMaterials(courseMaterials)}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    <span>Study & Summarize</span>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMaterialModal(true)}
                >
                  + Add material
                </Button>
              </div>
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
                        <Badge variant="outline" size="sm">
                          Blackboard
                        </Badge>
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
                        <Badge variant="subtle" size="sm">
                          {mat.type}
                        </Badge>
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
                      title="Delete material"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Course Announcements */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Megaphone size={14} aria-hidden="true" />
                <span>Announcements</span>
                <Badge variant="subtle" size="sm">
                  {bbAnnouncements.length}
                </Badge>
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
                        <Megaphone
                          size={14}
                          style={{ color: "var(--text-secondary)" }}
                          aria-hidden="true"
                        />
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
        </div>
      ) : null}

      {/* Tab 3: Intelligence & Activity */}
      {activeTab === "intelligence" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Predictions Panel */}
          <CoursePredictionsPanel
            courseId={course.id}
            courseCode={course.code}
            syllabuses={courseMaterials
              .filter((material) => material.type === "syllabus")
              .map((material) => ({ id: material.id, title: material.title }))}
          />

          {/* Recent Blackboard Activity for this Course */}
          <SchoolActivityFeed
            events={courseEvents}
            courses={allCourses}
            timeZone={timeZone}
            title={`Recent Blackboard Activity for ${course.code}`}
          />
        </div>
      ) : null}

      {/* Modals */}
      {showMeetingModal ? (
        <MeetingFormModal
          courseId={course.id}
          courseCode={course.code}
          courseLocation={course.location}
          today={today}
          timeZone={timeZone}
          meeting={editingMeeting}
          onClose={() => {
            setShowMeetingModal(false);
            setEditingMeeting(null);
          }}
        />
      ) : null}

      {showMaterialModal ? (
        <MaterialFormModal
          courseId={course.id}
          courseCode={course.code}
          onClose={() => setShowMaterialModal(false)}
        />
      ) : null}

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
