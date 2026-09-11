"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import type { CourseWithMeetings } from "@/types/course";
import type { CourseMaterial } from "@/types/course-material";
import type { SchoolEmailEvent, SchoolItem } from "@/types/school-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl, type SegmentOption } from "@/components/ui/segmented-control";
import { SchoolTodayContext } from "./school-today-context";
import { CourseCard } from "./course-card";
import { CourseFormModal } from "./course-form-modal";
import { CourseImportModal } from "./course-import-modal";
import { SchoolTimetableView } from "./school-timetable-view";
import { SchoolUpcomingWork } from "./school-upcoming-work";
import { SchoolActivityFeed } from "./school-activity-feed";
import { SchoolCourseDetail } from "./school-course-detail";
import styles from "./school-workspace.module.css";

type SchoolViewTab = "overview" | "timetable" | "activity";

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
  const [activeTab, setActiveTab] = useState<SchoolViewTab>("overview");
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Unresolved mapping check
  const unresolvedEvents = useMemo(
    () => emailEvents.filter((e) => e.status === "unresolved_course"),
    [emailEvents],
  );

  // Pre-calculate upcoming work counts per course
  const upcomingWorkCountByCourse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of schoolItems) {
      if (
        item.itemType === "assignment" ||
        item.itemType === "quiz" ||
        item.itemType === "exam"
      ) {
        counts.set(item.courseId, (counts.get(item.courseId) ?? 0) + 1);
      }
    }
    return counts;
  }, [schoolItems]);

  const viewOptions: Array<SegmentOption<SchoolViewTab>> = useMemo(
    () => [
      { value: "overview", label: "Overview" },
      { value: "timetable", label: "Timetable" },
      {
        value: "activity",
        label: unresolvedEvents.length > 0 ? `Sync (${unresolvedEvents.length})` : "Sync & Activity",
      },
    ],
    [unresolvedEvents.length],
  );

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  // If a specific course is selected, render Course Detail View
  if (selectedCourse) {
    return (
      <div className={styles.pageContainer}>
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

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeaderWrap}>
        <PageHeader
          title="School"
          description="Courses, assignments, timetable meetings, materials, and Blackboard notifications stay owner-scoped and project directly to Home, Tasks, and Calendar."
        />
      </div>

      <div className={styles.layout}>
        {/* Overview Toolbar */}
        <div className={styles.toolbar}>
        <div className={styles.titleGroup}>
          <p className={styles.kicker}>Academic Operating System</p>
          <h2 className={styles.toolbarTitle}>
            {courses.length} Active {courses.length === 1 ? "Course" : "Courses"}
          </h2>
        </div>

        <div className={styles.toolbarActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowImport(true)}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>Import Syllabus</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddCourse(true)}
          >
            <Plus size={15} aria-hidden="true" />
            <span>Add Course</span>
          </Button>
        </div>
      </div>

      {/* Unresolved course mapping alert banner */}
      {unresolvedEvents.length > 0 ? (
        <div className={styles.alertBanner} role="alert">
          <div className={styles.alertBannerContent}>
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>Course mapping needed: </strong>
              <span>
                {unresolvedEvents.length} Blackboard notification{unresolvedEvents.length === 1 ? "" : "s"} could not be automatically matched.
              </span>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActiveTab("activity")}
          >
            Resolve Mappings →
          </Button>
        </div>
      ) : null}

      {/* View Switcher Tabs */}
      <div className={styles.viewTabs}>
        <SegmentedControl
          options={viewOptions}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="School sections"
        />

        {unresolvedEvents.length > 0 && activeTab !== "activity" ? (
          <Badge tone="warning" variant="subtle" size="sm">
            {unresolvedEvents.length} Action Needed
          </Badge>
        ) : null}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" ? (
        <div className={styles.overviewLayout}>
          {/* Today's Academic Context */}
          <SchoolTodayContext
            courses={courses}
            timeZone={timeZone}
            onSelectCourse={(id) => setSelectedCourseId(id)}
          />

          {/* Active Courses Section */}
          <div className={styles.coursesSection}>
            <div className={styles.coursesHeader}>
              <h3 className={styles.sectionTitle}>
                <BookOpen size={14} aria-hidden="true" />
                <span>Active Courses</span>
              </h3>
              <Badge variant="subtle" size="sm">
                {courses.length}
              </Badge>
            </div>

            {courses.length === 0 ? (
              <div className={styles.emptyCourses}>
                <BookOpen size={36} aria-hidden="true" />
                <h3>No courses configured yet</h3>
                <p>
                  Add a course manually or import a syllabus to track lectures, assignments, and automated Blackboard notifications.
                </p>
                <div style={{ marginTop: "0.5rem" }}>
                  <Button variant="primary" onClick={() => setShowAddCourse(true)}>
                    <Plus size={15} aria-hidden="true" />
                    <span>Add your first course</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.coursesGrid}>
                {courses.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    upcomingWorkCount={upcomingWorkCountByCourse.get(course.id) ?? 0}
                    onSelect={(id) => setSelectedCourseId(id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Actionable Academic Work */}
          <SchoolUpcomingWork
            items={schoolItems}
            courses={courses}
            today={today}
            timeZone={timeZone}
            onSelectCourse={(id) => setSelectedCourseId(id)}
          />
        </div>
      ) : null}

      {/* TAB 2: TIMETABLE */}
      {activeTab === "timetable" ? (
        <SchoolTimetableView
          courses={courses}
          today={today}
          timeZone={timeZone}
          onSelectCourse={(id) => setSelectedCourseId(id)}
        />
      ) : null}

      {/* TAB 3: SYNC & ACTIVITY */}
      {activeTab === "activity" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Blackboard Activity Feed & Mapping Resolution */}
          <SchoolActivityFeed
            events={emailEvents}
            courses={courses}
            timeZone={timeZone}
            onSelectCourse={(id) => setSelectedCourseId(id)}
            title="Blackboard Notification Activity & Course Mappings"
          />
        </div>
      ) : null}

      {/* Modals */}
      {showAddCourse ? (
        <CourseFormModal
          onClose={() => setShowAddCourse(false)}
        />
      ) : null}

      {showImport ? (
        <CourseImportModal
          onClose={() => setShowImport(false)}
        />
      ) : null}
      </div>
    </div>
  );
}
