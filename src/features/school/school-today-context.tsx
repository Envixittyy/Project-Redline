"use client";

import {
  BookOpen,
  Calendar,
  Clock,
  MapPin,
} from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import {
  projectTodayClasses,
  resolveNextClass,
  type ClassMeetingOccurrence,
} from "@/features/home/home-classes";
import { Badge } from "@/components/ui/badge";
import styles from "./school-today-context.module.css";

type SchoolTodayContextProps = {
  courses: CourseWithMeetings[];
  timeZone: string;
  onSelectCourse: (courseId: string) => void;
};

export function SchoolTodayContext({
  courses,
  timeZone,
  onSelectCourse,
}: SchoolTodayContextProps) {
  const occurrences = projectTodayClasses(courses, timeZone);
  const nextClass = resolveNextClass(courses, timeZone);

  // In-progress class takes precedence for the featured banner
  const inProgress = occurrences.find((c) => c.status === "in_progress");
  const upcomingToday = occurrences.find((c) => c.status === "upcoming");

  const featured = inProgress || upcomingToday;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.headerTitle}>
          <Calendar size={14} aria-hidden="true" />
          <span>Today&apos;s Schedule</span>
        </h3>
        {occurrences.length > 0 ? (
          <Badge variant="subtle" size="sm">
            {occurrences.length} {occurrences.length === 1 ? "class" : "classes"}
          </Badge>
        ) : null}
      </div>

      <div className={styles.scheduleCanvas}>
        {/* Featured in-progress or next class banner */}
        {featured ? (
          <div
            className={styles.featuredBanner}
            style={
              {
                "--banner-accent": featured.courseColor ?? "var(--accent)",
              } as React.CSSProperties
            }
            onClick={() => onSelectCourse(featured.courseId)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectCourse(featured.courseId);
              }
            }}
            aria-label={`View course ${featured.courseCode} - ${featured.courseName}`}
          >
            <div className={styles.bannerContent}>
              <div className={styles.bannerMetaRow}>
                <span
                  className={styles.bannerStatus}
                  style={{
                    color:
                      featured.status === "in_progress"
                        ? "var(--success)"
                        : "var(--accent-text)",
                  }}
                >
                  {featured.status === "in_progress" ? (
                    <>
                      <span className={styles.liveIndicator} aria-hidden="true" />
                      <span>In Progress Now</span>
                    </>
                  ) : (
                    <span>Next Class Today</span>
                  )}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
                  · {featured.relativeTimeText}
                </span>
              </div>

              <div className={styles.bannerTitleRow}>
                <span className={styles.bannerCourseCode}>
                  {featured.courseCode}
                </span>
                <span className={styles.bannerCourseName}>
                  {featured.courseName}
                </span>
              </div>

              <div className={styles.bannerDetails}>
                <span className={styles.bannerDetailItem}>
                  <Clock size={13} aria-hidden="true" />
                  <span>{featured.timeRangeFormatted}</span>
                </span>
                <span className={styles.bannerDetailItem}>
                  <BookOpen size={13} aria-hidden="true" />
                  <span>{featured.meetingTitle}</span>
                </span>
                {featured.location ? (
                  <span className={styles.bannerDetailItem}>
                    <MapPin size={13} aria-hidden="true" />
                    <span>{featured.location}</span>
                  </span>
                ) : null}
              </div>
            </div>

            <Badge variant="outline" size="sm">
              Open Course →
            </Badge>
          </div>
        ) : null}

        {/* Chronological list of today's classes */}
        {occurrences.length > 0 ? (
          <ul className={styles.classesList}>
            {occurrences.map((item: ClassMeetingOccurrence) => (
              <li
                key={`${item.meetingId}-${item.date}`}
                className={styles.classItem}
                data-status={item.status}
                style={
                  {
                    "--course-accent": item.courseColor ?? "var(--accent)",
                  } as React.CSSProperties
                }
                onClick={() => onSelectCourse(item.courseId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectCourse(item.courseId);
                  }
                }}
                aria-label={`Open ${item.courseCode}: ${item.meetingTitle} at ${item.timeRangeFormatted}`}
              >
                <div className={styles.classTop}>
                  <div className={styles.classCodeGroup}>
                    <span className={styles.classCode}>{item.courseCode}</span>
                    <span className={styles.className}>{item.courseName}</span>
                  </div>
                  <span className={styles.classTime}>
                    <Clock size={12} aria-hidden="true" />
                    <span>{item.timeRangeFormatted}</span>
                  </span>
                </div>

                <div className={styles.classBottom}>
                  <span className={styles.classLocation}>
                    {item.location ? (
                      <>
                        <MapPin size={11} aria-hidden="true" />
                        <span>{item.location}</span>
                      </>
                    ) : (
                      <span>{item.meetingTitle}</span>
                    )}
                  </span>
                  <Badge
                    tone={item.status === "in_progress" ? "success" : "neutral"}
                    variant={item.status === "past" ? "outline" : "subtle"}
                    size="sm"
                  >
                    {item.status === "in_progress"
                      ? "Now"
                      : item.status === "past"
                        ? "Done"
                        : "Upcoming"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.emptyToday}>
            <Calendar size={18} aria-hidden="true" />
            <div>
              <strong>No classes scheduled for today.</strong>
              {nextClass.kind === "none_today" && nextClass.nextOccurrence ? (
                <p style={{ margin: "0.2rem 0 0", color: "var(--text-tertiary)", fontSize: "0.78rem" }}>
                  Next up is <strong>{nextClass.nextOccurrence.courseCode}</strong> ({nextClass.nextOccurrence.meetingTitle}) on {nextClass.nextOccurrence.date} at {nextClass.nextOccurrence.timeRangeFormatted}.
                </p>
              ) : (
                <p style={{ margin: "0.2rem 0 0", color: "var(--text-tertiary)", fontSize: "0.78rem" }}>
                  Your academic timetable is open today.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
