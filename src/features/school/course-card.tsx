"use client";

import { Calendar, ChevronRight, MapPin, User } from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import { Badge } from "@/components/ui/badge";
import styles from "./course-card.module.css";

const weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CourseCardProps = {
  course: CourseWithMeetings;
  upcomingWorkCount: number;
  onSelect: (courseId: string) => void;
};

export function CourseCard({
  course,
  upcomingWorkCount,
  onSelect,
}: CourseCardProps) {
  const scheduleSummary =
    course.meetings.length > 0
      ? course.meetings
          .map(
            (m) =>
              `${m.weekdays.map((d) => weekdaysShort[d]).join(", ")} ${m.startTime}`,
          )
          .join(" · ")
      : null;

  return (
    <div
      className={styles.card}
      style={
        {
          "--card-course-accent": course.color ?? "var(--accent)",
        } as React.CSSProperties
      }
      onClick={() => onSelect(course.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(course.id);
        }
      }}
      aria-label={`View course ${course.code} - ${course.name}`}
    >
      <div className={styles.topSection}>
        <div className={styles.headerRow}>
          <span className={styles.codeBadge}>
            <span className={styles.dot} aria-hidden="true" />
            <span>{course.code}</span>
          </span>
          {course.location ? (
            <span className={styles.metaItem}>
              <MapPin size={12} aria-hidden="true" />
              <span>{course.location}</span>
            </span>
          ) : null}
        </div>

        <h4 className={styles.title}>{course.name}</h4>

        <div className={styles.metaRow}>
          {scheduleSummary ? (
            <span className={styles.metaItem}>
              <Calendar size={12} aria-hidden="true" />
              <span>{scheduleSummary}</span>
            </span>
          ) : (
            <span style={{ color: "var(--text-tertiary)" }}>No regular meetings</span>
          )}
          {course.instructor ? (
            <span className={styles.metaItem}>
              <User size={12} aria-hidden="true" />
              <span>{course.instructor}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.bottomSection}>
        <span
          className={styles.workCount}
          data-has-work={upcomingWorkCount > 0 || undefined}
        >
          {upcomingWorkCount > 0 ? (
            <Badge variant="subtle" size="sm">
              {upcomingWorkCount} upcoming {upcomingWorkCount === 1 ? "task" : "tasks"}
            </Badge>
          ) : (
            <span style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
              All caught up
            </span>
          )}
        </span>

        <span className={styles.openIndicator}>
          <span>Details</span>
          <ChevronRight size={14} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
