import { BookOpen, CalendarCheck, Clock, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";

import { Surface } from "@/components/ui/surface";
import type { CourseWithMeetings } from "@/types/course";

import { resolveNextClass } from "./home-classes";
import styles from "./home-dashboard.module.css";

type NextClassCardProps = {
  courses: CourseWithMeetings[];
  timeZone: string;
};

export function NextClassCard({ courses, timeZone }: NextClassCardProps) {
  const result = resolveNextClass(courses, timeZone);

  if (result.kind === "none_configured") {
    return (
      <Surface
        variant="glass"
        className={`${styles.card} motion-enter`}
        data-dashboard-widget="next_class"
      >
        <header>
          <span aria-hidden="true">
            <BookOpen size={18} />
          </span>
          <div>
            <p>Next Class</p>
            <h3>No classes set</h3>
          </div>
          <Link href="/school">Setup</Link>
        </header>
        <p className={styles.empty}>
          Add courses and your weekly timetable in School to see your next class here.
        </p>
      </Surface>
    );
  }

  if (result.kind === "none_today" || result.kind === "no_more_today") {
    const isDone = result.kind === "no_more_today";
    const nextOcc = result.nextOccurrence;

    return (
      <Surface
        variant="glass"
        className={`${styles.card} motion-enter`}
        data-dashboard-widget="next_class"
      >
        <header>
          <span aria-hidden="true">
            <CalendarCheck size={18} />
          </span>
          <div>
            <p>Next Class</p>
            <h3>{isDone ? "All done for today" : "No classes today"}</h3>
          </div>
          <Link href="/school">School</Link>
        </header>

        {nextOcc ? (
          <div className={styles.nextClassUpcomingBox}>
            <div className={styles.nextClassHeaderRow}>
              <span
                className={styles.courseBadgeDot}
                style={{ background: nextOcc.courseColor ?? "var(--accent)" }}
                aria-hidden="true"
              />
              <span className={styles.nextClassCode}>{nextOcc.courseCode}</span>
              <span className={styles.nextClassTimeTag}>{nextOcc.startTimeFormatted}</span>
            </div>
            <strong className={styles.nextClassName}>{nextOcc.courseName}</strong>
            <small className={styles.nextClassMeta}>
              Next class on {nextOcc.date} · {nextOcc.timeRangeFormatted}
              {nextOcc.location ? ` · ${nextOcc.location}` : ""}
            </small>
          </div>
        ) : (
          <p className={styles.empty}>
            {isDone
              ? "You have completed all scheduled classes for today."
              : "No classes scheduled for today. Enjoy the open time."}
          </p>
        )}
      </Surface>
    );
  }

  const { occurrence } = result;
  const isInProgress = result.kind === "in_progress";

  return (
    <Surface
      variant="glass"
      className={`${styles.card} ${isInProgress ? styles.cardActive : ""} motion-enter`}
      data-dashboard-widget="next_class"
    >
      <header>
        <span
          style={{
            background: occurrence.courseColor
              ? `color-mix(in srgb, ${occurrence.courseColor} 20%, transparent)`
              : undefined,
            color: occurrence.courseColor ?? undefined,
          }}
          aria-hidden="true"
        >
          {isInProgress ? <Sparkles size={18} /> : <BookOpen size={18} />}
        </span>
        <div>
          <p>{isInProgress ? "Current Class" : "Next Class"}</p>
          <h3>{occurrence.relativeTimeText}</h3>
        </div>
        <Link href="/school">Open</Link>
      </header>

      <div className={styles.nextClassBody}>
        <div className={styles.nextClassHeaderRow}>
          <span
            className={styles.courseBadgeDot}
            style={{ background: occurrence.courseColor ?? "var(--accent)" }}
            aria-hidden="true"
          />
          <strong className={styles.nextClassCode}>{occurrence.courseCode}</strong>
          <span className={styles.nextClassPill} data-status={occurrence.status}>
            {isInProgress ? "In progress" : "Upcoming"}
          </span>
        </div>

        <h4 className={styles.nextClassTitle}>{occurrence.courseName}</h4>

        <div className={styles.nextClassMetaList}>
          <div className={styles.nextClassMetaItem}>
            <Clock size={14} aria-hidden="true" />
            <span>{occurrence.timeRangeFormatted}</span>
          </div>
          {occurrence.location ? (
            <div className={styles.nextClassMetaItem}>
              <MapPin size={14} aria-hidden="true" />
              <span>{occurrence.location}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

