"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ExternalLink,
  FileCheck,
  FileQuestion,
  GraduationCap,
  Loader2,
  Megaphone,
  RotateCw,
  Sparkles,
} from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import type { SchoolEmailEvent } from "@/types/school-item";
import {
  mapSchoolEmailCourseAction,
  retrySchoolEmailAction,
} from "./school-email-actions";
import { findSchoolEventCourse } from "./school-ui-domain";
import styles from "./school-activity-feed.module.css";

type SchoolActivityFeedProps = {
  events: SchoolEmailEvent[];
  courses: CourseWithMeetings[];
  timeZone: string;
  onSelectCourse?: (courseId: string) => void;
  title?: string;
};

function formatTimestamp(iso: string, timeZone: string): string {
  try {
    const date = new Date(iso);
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return iso;
  }
}

export function SchoolActivityFeed({
  events,
  courses,
  timeZone,
  onSelectCourse,
  title = "Recent School Activity",
}: SchoolActivityFeedProps) {
  const [selectedCourses, setSelectedCourses] = useState<Record<string, string>>({});
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleMapAndRetry = (event: SchoolEmailEvent) => {
    const courseKey = event.parsedEvent.courseKey;
    const courseId = selectedCourses[event.id] || courses[0]?.id;

    if (!courseKey || !courseId) return;

    setBusyEventId(event.id);
    setMappingError(null);

    startTransition(async () => {
      const mapRes = await mapSchoolEmailCourseAction(courseKey, courseId);
      if (!mapRes.ok) {
        setMappingError(mapRes.message);
        setBusyEventId(null);
        return;
      }
      const retryRes = await retrySchoolEmailAction(event.id);
      if (!retryRes.ok) {
        setMappingError(retryRes.message);
      }
      setBusyEventId(null);
    });
  };

  // Only show processed or reviewable events (filter out internal ignored/malformed spam)
  const displayableEvents = events.filter(
    (e) =>
      e.status === "processed" ||
      e.status === "unresolved_course" ||
      e.status === "unresolved_item" ||
      e.status === "unresolved_task",
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>
          <span>{title}</span>
          <span className={styles.countBadge}>{displayableEvents.length}</span>
        </h3>
      </div>

      {mappingError ? (
        <div className={styles.unresolvedCard} role="alert">
          <p style={{ color: "var(--destructive)", margin: 0 }}>{mappingError}</p>
        </div>
      ) : null}

      {displayableEvents.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No recent Blackboard activity recorded.</p>
        </div>
      ) : (
        <ul className={styles.feed}>
          {displayableEvents.map((event) => {
            const parsed = event.parsedEvent;
            const isUnresolved = event.status === "unresolved_course";
            const isBusy = busyEventId === event.id;

            // Render review card if unresolved course
            if (isUnresolved) {
              return (
                <li key={event.id} className={styles.unresolvedCard}>
                  <div className={styles.unresolvedHeader}>
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>Course Mapping Needed</span>
                  </div>
                  <div className={styles.unresolvedBody}>
                    <p style={{ margin: "0 0 0.35rem" }}>
                      An incoming Blackboard notification could not be automatically matched to an active course.
                    </p>
                    {parsed.courseHint ? (
                      <p style={{ margin: "0 0 0.35rem" }}>
                        <strong>Detected Course hint:</strong> {parsed.courseHint}
                      </p>
                    ) : null}
                    {parsed.title ? (
                      <p style={{ margin: 0 }}>
                        <strong>Item title:</strong> {parsed.title}
                      </p>
                    ) : null}
                  </div>
                  {courses.length > 0 && parsed.courseKey ? (
                    <div className={styles.unresolvedForm}>
                      <select
                        aria-label="Select corresponding course"
                        value={selectedCourses[event.id] || courses[0]?.id || ""}
                        onChange={(e) =>
                          setSelectedCourses((prev) => ({
                            ...prev,
                            [event.id]: e.target.value,
                          }))
                        }
                      >
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleMapAndRetry(event)}
                      >
                        {isBusy ? (
                          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <RotateCw size={15} aria-hidden="true" />
                        )}
                        <span>Map & Retry</span>
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            }

            // Normal processed activity row
            const notifType = parsed.notificationType;
            const itemType = parsed.itemType;
            const isDeadlineChange = notifType === "deadline_changed";
            const isActionable =
              itemType === "assignment" ||
              itemType === "quiz" ||
              itemType === "exam" ||
              isDeadlineChange;

            // Choose icon
            let Icon = FileCheck;
            let iconClass = styles.actionableIcon;
            let label = "New Assignment";

            if (isDeadlineChange) {
              Icon = CalendarClock;
              iconClass = styles.deadlineChangedIcon;
              label = "Deadline Updated";
            } else if (itemType === "quiz") {
              Icon = FileQuestion;
              iconClass = styles.actionableIcon;
              label = "New Quiz";
            } else if (itemType === "exam") {
              Icon = GraduationCap;
              iconClass = styles.actionableIcon;
              label = "Exam Scheduled";
            } else if (itemType === "material") {
              Icon = BookOpen;
              iconClass = styles.informationalIcon;
              label = "New Material";
            } else if (itemType === "announcement") {
              Icon = Megaphone;
              iconClass = styles.informationalIcon;
              label = "Announcement";
            } else if (itemType === "course_opened") {
              Icon = Sparkles;
              iconClass = styles.informationalIcon;
              label = "Course Opened";
            }

            const course = findSchoolEventCourse(event, courses);
            if (event.status === "unresolved_item") {
              Icon = AlertTriangle;
              iconClass = styles.deadlineChangedIcon;
              label = "Item Match Needs Review";
            } else if (event.status === "unresolved_task") {
              Icon = AlertTriangle;
              iconClass = styles.deadlineChangedIcon;
              label = "Linked Task Removed";
            }

            return (
              <li key={event.id} className={styles.item}>
                <div className={`${styles.iconWrapper} ${iconClass}`}>
                  <Icon size={16} aria-hidden="true" />
                </div>

                <div className={styles.body}>
                  <div className={styles.titleLine}>
                    <span
                      className={`${styles.categoryBadge} ${
                        isActionable
                          ? styles.categoryActionable
                          : styles.categoryInformational
                      }`}
                    >
                      {label}
                    </span>

                    {course ? (
                      <button
                        type="button"
                        className={styles.coursePill}
                        onClick={() => onSelectCourse?.(course.id)}
                        aria-label={`View course ${course.code}`}
                      >
                        <span
                          className={styles.swatch}
                          style={{
                            backgroundColor: course.color ?? "var(--accent)",
                          }}
                          aria-hidden="true"
                        />
                        <span>{course.code}</span>
                      </button>
                    ) : parsed.courseHint ? (
                      <span className={styles.coursePill}>
                        <span>{parsed.courseHint}</span>
                      </span>
                    ) : null}

                    <span className={styles.title}>
                      {parsed.title ?? "Blackboard Update"}
                    </span>
                  </div>

                  <div className={styles.metaLine}>
                    <span>{formatTimestamp(event.receivedAt, timeZone)}</span>

                    {parsed.sourceUrl ? (
                      <a
                        href={parsed.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.blackboardLink}
                        aria-label={`Open ${parsed.title ?? "item"} in Blackboard`}
                      >
                        <span>Open in Blackboard</span>
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
