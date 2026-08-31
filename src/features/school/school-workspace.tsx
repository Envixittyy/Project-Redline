"use client";

import {
  BookOpen,
  CalendarPlus,
  ExternalLink,
  FileText,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import { courseMaterialTypes, type CourseMaterial } from "@/types/course-material";
import type { CourseWithMeetings } from "@/types/course";

import {
  archiveCourseAction,
  deleteMeetingAction,
  saveCourseAction,
  saveMeetingAction,
} from "./school-actions";
import {
  deleteCourseMaterialAction,
  saveCourseMaterialAction,
} from "./school-material-actions";
import { CourseImportModal } from "./course-import-modal";
import styles from "./school-workspace.module.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SchoolWorkspaceProps = {
  courses: CourseWithMeetings[];
  materials: CourseMaterial[];
  today: string;
  timeZone: string;
};

export function SchoolWorkspace({
  courses,
  materials,
  today,
  timeZone,
}: SchoolWorkspaceProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [activeMeetingCourseId, setActiveMeetingCourseId] = useState<string | null>(null);
  const [activeMaterialCourseId, setActiveMaterialCourseId] = useState<string | null>(null);

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
    <div className={styles.layout}>
      {showImport ? (
        <CourseImportModal
          onClose={() => setShowImport(false)}
        />
      ) : null}

      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>Academic Timetable & Materials</p>
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
            <Sparkles size={16} aria-hidden="true" /> Import Syllabus
          </button>
          <button
            onClick={() => setShowAddCourse((v) => !v)}
            type="button"
            aria-expanded={showAddCourse}
            className="motion-interactive"
          >
            <Plus size={17} aria-hidden="true" /> Add course
          </button>
        </div>
      </div>

      {error ? (
        <Surface variant="subtle" className={styles.error} role="alert">
          {error}
        </Surface>
      ) : null}

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
          <h2>No courses yet</h2>
          <p>
            Add a course, attach its weekly timetable, and organize syllabus, readings, and lecture materials.
          </p>
        </Surface>
      ) : (
        <div className={styles.courses}>
          {courses.map((course) => {
            const courseMaterials = materials.filter((m) => m.courseId === course.id);

            return (
              <Surface
                key={course.id}
                variant="base"
                className={styles.course}
                style={{ "--course-color": course.color ?? "var(--accent)" } as React.CSSProperties}
              >
                <header>
                  <span className={styles.swatch} aria-hidden="true" />
                  <div>
                    <p>{course.code}</p>
                    <h2>{course.name}</h2>
                    <small>
                      {[course.instructor, course.location].filter(Boolean).join(" · ") ||
                        "No instructor or room set"}
                    </small>
                  </div>
                  <div className={styles.courseHeaderActions}>
                    <button
                      type="button"
                      aria-label={`Add meeting to ${course.code}`}
                      onClick={() =>
                        setActiveMeetingCourseId(
                          activeMeetingCourseId === course.id ? null : course.id,
                        )
                      }
                    >
                      <CalendarPlus size={15} aria-hidden="true" /> Meeting
                    </button>
                    <button
                      type="button"
                      aria-label={`Add material to ${course.code}`}
                      onClick={() =>
                        setActiveMaterialCourseId(
                          activeMaterialCourseId === course.id ? null : course.id,
                        )
                      }
                    >
                      <FileText size={15} aria-hidden="true" /> Material
                    </button>
                  </div>
                </header>

                {/* Meeting Form */}
                {activeMeetingCourseId === course.id ? (
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
                        () => setActiveMeetingCourseId(null),
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
                {activeMaterialCourseId === course.id ? (
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
                        () => setActiveMaterialCourseId(null),
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
                          placeholder="https://drive.google.com/... or https://..."
                        />
                      </label>
                    </div>
                    <label>
                      Description / Notes (Optional)
                      <textarea
                        name="description"
                        rows={2}
                        placeholder="Key points, required readings, or instructions..."
                      />
                    </label>
                    <button disabled={pending} type="submit">
                      {pending ? "Saving..." : "Save material"}
                    </button>
                  </form>
                ) : null}

                {/* Meetings List */}
                <div className={styles.subSection}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                      Timetable ({course.meetings.length})
                    </span>
                  </div>
                  {course.meetings.length > 0 ? (
                    <ul className={styles.meetings}>
                      {course.meetings.map((meeting) => (
                        <li key={meeting.id}>
                          <div>
                            <strong>{meeting.title}</strong>
                            <span>
                              {meeting.weekdays.map((day) => weekdays[day]).join(", ")} ·{" "}
                              {meeting.startTime}–{meeting.endTime}
                            </span>
                            {meeting.location ? (
                              <span>
                                <MapPin size={12} aria-hidden="true" />
                                {meeting.location}
                              </span>
                            ) : null}
                          </div>
                          <button
                            className={styles.deleteButton}
                            aria-label={`Delete ${meeting.title}`}
                            type="button"
                            onClick={() => run(() => deleteMeetingAction(meeting.id))}
                          >
                            <Trash2 size={15} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <small style={{ color: "var(--text-tertiary)" }}>
                      No weekly meetings configured.
                    </small>
                  )}
                </div>

                {/* Materials List */}
                <div className={styles.subSection}>
                  <div className={styles.sectionHeader}>
                    <span className={styles.sectionTitle}>
                      Materials ({courseMaterials.length})
                    </span>
                  </div>
                  {courseMaterials.length > 0 ? (
                    <ul className={styles.materials}>
                      {courseMaterials.map((mat) => (
                        <li key={mat.id}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span className={styles.materialTypeBadge}>{mat.type}</span>
                              <strong>{mat.title}</strong>
                            </div>
                            {mat.url ? (
                              <span>
                                <a
                                  href={mat.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.materialLink}
                                >
                                  Open resource <ExternalLink size={11} aria-hidden="true" />
                                </a>
                              </span>
                            ) : null}
                            {mat.description ? (
                              <p className={styles.materialDescription}>{mat.description}</p>
                            ) : null}
                          </div>
                          <button
                            className={styles.deleteButton}
                            aria-label={`Delete ${mat.title}`}
                            type="button"
                            onClick={() => run(() => deleteCourseMaterialAction(mat.id))}
                          >
                            <Trash2 size={15} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <small style={{ color: "var(--text-tertiary)" }}>
                      No course materials attached yet.
                    </small>
                  )}
                </div>

                <button
                  className={styles.archive}
                  type="button"
                  onClick={() => run(() => archiveCourseAction(course.id))}
                >
                  Archive course
                </button>
              </Surface>
            );
          })}
        </div>
      )}
    </div>
  );
}
