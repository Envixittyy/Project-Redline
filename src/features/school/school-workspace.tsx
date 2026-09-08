"use client";

import { useState, useTransition } from "react";
import {
  BookOpen,
  Calendar,
  ChevronRight,
  MapPin,
  Plus,
  Sparkles,
} from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import type { CourseMaterial } from "@/types/course-material";
import type { SchoolItem } from "@/types/school-item";
import type { SchoolEmailEvent } from "@/services/school/school-repository";
import { Surface } from "@/components/ui/surface";
import { saveCourseAction } from "./school-actions";
import { CourseImportModal } from "./course-import-modal";
import { SchoolUpcomingWork } from "./school-upcoming-work";
import { SchoolActivityFeed } from "./school-activity-feed";
import { SchoolCourseDetail } from "./school-course-detail";
import styles from "./school-workspace.module.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SchoolWorkspaceProps = {
  courses: CourseWithMeetings[];
  schoolItems: SchoolItem[];
  materials: CourseMaterial[];
  emailEvents: SchoolEmailEvent[];
  today: string;
  timeZone: string;
  initialCourseId?: string | null;
};

export function SchoolWorkspace({
  courses,
  schoolItems,
  materials,
  emailEvents,
  today,
  timeZone,
  initialCourseId = null,
}: SchoolWorkspaceProps) {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialCourseId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showImport, setShowImport] = useState(false);

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

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  // If a specific course is selected, render Course Detail View
  if (selectedCourse) {
    return (
      <div className={styles.layout}>
        <SchoolCourseDetail
          course={selectedCourse}
          allCourses={courses}
          items={schoolItems}
          materials={materials}
          events={emailEvents}
          today={today}
          timeZone={timeZone}
          onBack={() => setSelectedCourseId(null)}
        />
      </div>
    );
  }

  // Otherwise render School Overview
  return (
    <div className={styles.layout}>
      {showImport ? (
        <CourseImportModal onClose={() => setShowImport(false)} />
      ) : null}

      {/* Overview Toolbar */}
      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>Academic Timetable & Course Activity</p>
          <h2>
            {courses.length} active {courses.length === 1 ? "course" : "courses"}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            onClick={() => setShowImport(true)}
            type="button"
            className="motion-interactive"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>Import Course (Text)</span>
          </button>
          <button
            onClick={() => setShowAddCourse((v) => !v)}
            type="button"
            aria-expanded={showAddCourse}
            className="motion-interactive"
          >
            <Plus size={17} aria-hidden="true" />
            <span>Add course</span>
          </button>
        </div>
      </div>

      {error ? (
        <Surface variant="subtle" className={styles.error} role="alert">
          {error}
        </Surface>
      ) : null}

      {/* Add Course Form */}
      {showAddCourse ? (
        <Surface variant="glass" className={styles.formCard}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(
                () =>
                  saveCourseAction(null, {
                    code: String(data.get("code")),
                    name: String(data.get("name")),
                    instructor: String(data.get("instructor")),
                    location: String(data.get("location")),
                    color: String(data.get("color")),
                  }),
                () => setShowAddCourse(false),
              );
            }}
          >
            <div className={styles.formGrid}>
              <label>
                Code
                <input name="code" maxLength={30} placeholder="e.g. CS101" required />
              </label>
              <label>
                Name
                <input name="name" maxLength={200} placeholder="e.g. Intro to Computer Science" required />
              </label>
              <label>
                Instructor
                <input name="instructor" maxLength={200} placeholder="e.g. Dr. Alan Turing" />
              </label>
              <label>
                Location / Room
                <input name="location" maxLength={200} placeholder="e.g. Turing Hall 301" />
              </label>
              <label>
                Color
                <input name="color" type="color" defaultValue="#287ca7" />
              </label>
            </div>
            <button disabled={pending} type="submit">
              {pending ? "Saving..." : "Save course"}
            </button>
          </form>
        </Surface>
      ) : null}

      {courses.length === 0 ? (
        <Surface variant="subtle" className={styles.empty}>
          <BookOpen size={28} aria-hidden="true" />
          <h2>No courses configured yet</h2>
          <p>
            Add a course, attach weekly timetable meetings, and receive automated Blackboard notifications to track assignments and deadlines.
          </p>
        </Surface>
      ) : (
        <div className={styles.overviewLayout}>
          {/* Section 1: Upcoming Actionable Work (Question 1 & 2: What do I have due? Which Course is it for?) */}
          <SchoolUpcomingWork
            items={schoolItems}
            courses={courses}
            today={today}
            timeZone={timeZone}
            onSelectCourse={(courseId) => setSelectedCourseId(courseId)}
          />

          {/* Section 2: Current Courses Grid (Question 4: What Courses am I currently taking?) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                Current Courses ({courses.length})
              </span>
            </div>

            <div className={styles.coursesGrid}>
              {courses.map((course) => {
                const courseItems = schoolItems.filter((i) => i.courseId === course.id);
                const actionableCount = courseItems.filter(
                  (i) =>
                    i.itemType === "assignment" ||
                    i.itemType === "quiz" ||
                    i.itemType === "exam",
                ).length;

                return (
                  <div
                    key={course.id}
                    className={styles.courseCard}
                    onClick={() => setSelectedCourseId(course.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCourseId(course.id);
                      }
                    }}
                    aria-label={`View course ${course.code} - ${course.name}`}
                  >
                    <div>
                      <div className={styles.courseCardHeader}>
                        <span
                          className={styles.courseCardSwatch}
                          style={{
                            backgroundColor: course.color ?? "var(--accent)",
                          }}
                          aria-hidden="true"
                        />
                        <div>
                          <p className={styles.courseCardCode}>{course.code}</p>
                          <h4>{course.name}</h4>
                          <p className={styles.courseCardInstructor}>
                            {[course.instructor, course.location].filter(Boolean).join(" · ") ||
                              "No instructor set"}
                          </p>
                        </div>
                      </div>

                      <div className={styles.courseCardMeta}>
                        <div className={styles.courseCardMetaItem}>
                          <Calendar size={13} aria-hidden="true" />
                          <span>
                            {course.meetings.length > 0
                              ? course.meetings
                                  .map(
                                    (m) =>
                                      `${m.weekdays.map((d) => weekdays[d]).join(", ")} ${m.startTime}`,
                                  )
                                  .join(" | ")
                              : "No weekly meetings configured"}
                          </span>
                        </div>
                        {course.location ? (
                          <div className={styles.courseCardMetaItem}>
                            <MapPin size={13} aria-hidden="true" />
                            <span>{course.location}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={styles.courseCardFooter}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color:
                            actionableCount > 0
                              ? "var(--accent-text)"
                              : "var(--text-muted)",
                        }}
                      >
                        {actionableCount} upcoming {actionableCount === 1 ? "task" : "tasks"}
                      </span>

                      <span className={styles.viewCourseButton}>
                        <span>Details</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Recent Activity (Question 3: What changed recently?) */}
          <SchoolActivityFeed
            events={emailEvents}
            courses={courses}
            timeZone={timeZone}
            onSelectCourse={(courseId) => setSelectedCourseId(courseId)}
          />
        </div>
      )}
    </div>
  );
}
