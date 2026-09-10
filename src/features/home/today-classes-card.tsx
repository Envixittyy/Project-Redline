import { BookOpen, MapPin } from "lucide-react";
import Link from "next/link";

import { Surface } from "@/components/ui/surface";
import type { CourseWithMeetings } from "@/types/course";

import { projectTodayClasses } from "./home-classes";
import styles from "./home-dashboard.module.css";

type TodayClassesCardProps = {
  courses: CourseWithMeetings[];
  timeZone: string;
};

export function TodayClassesCard({ courses, timeZone }: TodayClassesCardProps) {
  const occurrences = projectTodayClasses(courses, timeZone);

  return (
    <Surface
      variant="base"
      className={`${styles.sectionCard} motion-enter`}
      data-dashboard-widget="today_classes"
    >
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitleGroup}>
          <span className={styles.sectionIconWrap} aria-hidden="true">
            <BookOpen size={16} />
          </span>
          <div>
            <p className={styles.sectionKicker}>School</p>
            <h3 className={styles.sectionTitle}>
              {occurrences.length
                ? `${occurrences.length} class${occurrences.length === 1 ? "" : "es"} today`
                : "No classes today"}
            </h3>
          </div>
        </div>
        <Link href="/school" className={styles.sectionAction}>
          School →
        </Link>
      </div>

      {occurrences.length > 0 ? (
        <ul className={styles.todayClassesList}>
          {occurrences.map((item) => (
            <li
              key={`${item.meetingId}-${item.date}`}
              className={styles.todayClassItem}
              data-status={item.status}
            >
              <span
                className={styles.todayClassColorBar}
                style={{ background: item.courseColor ?? "var(--accent)" }}
                aria-hidden="true"
              />
              <div className={styles.todayClassContent}>
                <div className={styles.todayClassTopRow}>
                  <strong className={styles.todayClassCode}>{item.courseCode}</strong>
                  <span className={styles.todayClassTime}>{item.timeRangeFormatted}</span>
                </div>
                <div className={styles.todayClassName}>{item.courseName}</div>
                <div className={styles.todayClassMetaRow}>
                  <span className={styles.todayClassMeetingTitle}>{item.meetingTitle}</span>
                  {item.location ? (
                    <span className={styles.todayClassLocation}>
                      <MapPin size={12} aria-hidden="true" />
                      {item.location}
                    </span>
                  ) : null}
                  <span
                    className={styles.todayClassStatusTag}
                    data-status={item.status}
                  >
                    {item.status === "in_progress"
                      ? "In progress"
                      : item.status === "past"
                        ? "Completed"
                        : "Upcoming"}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : courses.length > 0 ? (
        <p className={styles.empty}>
          No classes scheduled for today. Your timetable is open.
        </p>
      ) : (
        <p className={styles.empty}>
          Add courses and weekly meeting schedules in School.
        </p>
      )}
    </Surface>
  );
}
