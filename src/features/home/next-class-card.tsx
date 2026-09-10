import { BookOpen, CalendarCheck, Clock, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
        variant="base"
        className={`${styles.sectionCard} motion-enter`}
        data-dashboard-widget="next_class"
      >
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleGroup}>
            <span className={styles.sectionIconWrap} aria-hidden="true">
              <BookOpen size={16} />
            </span>
            <div>
              <p className={styles.sectionKicker}>School</p>
              <h3 className={styles.sectionTitle}>Next Class</h3>
            </div>
          </div>
          <Link href="/school" className={styles.sectionAction}>
            Setup →
          </Link>
        </div>
        <p className={styles.empty}>
          Add courses and your weekly timetable in School to track classes here.
        </p>
      </Surface>
    );
  }

  if (result.kind === "none_today" || result.kind === "no_more_today") {
    const isDone = result.kind === "no_more_today";
    const nextOcc = result.nextOccurrence;

    return (
      <Surface
        variant="base"
        className={`${styles.sectionCard} motion-enter`}
        data-dashboard-widget="next_class"
      >
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleGroup}>
            <span className={styles.sectionIconWrap} aria-hidden="true">
              <CalendarCheck size={16} />
            </span>
            <div>
              <p className={styles.sectionKicker}>School</p>
              <h3 className={styles.sectionTitle}>
                {isDone ? "Classes Finished" : "No Classes Today"}
              </h3>
            </div>
          </div>
          <Link href="/school" className={styles.sectionAction}>
            School →
          </Link>
        </div>

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
      variant="base"
      className={`${styles.sectionCard} ${isInProgress ? styles.cardActive : ""} motion-enter`}
      data-dashboard-widget="next_class"
    >
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitleGroup}>
          <span
            className={styles.sectionIconWrap}
            style={{
              color: occurrence.courseColor ?? undefined,
            }}
            aria-hidden="true"
          >
            {isInProgress ? <Sparkles size={16} /> : <BookOpen size={16} />}
          </span>
          <div>
            <p className={styles.sectionKicker}>
              {isInProgress ? "Current Class" : "Next Class"}
            </p>
            <h3 className={styles.sectionTitle}>{occurrence.relativeTimeText}</h3>
          </div>
        </div>
        <Link href="/school" className={styles.sectionAction}>
          School →
        </Link>
      </div>

      <div className={styles.nextClassBody}>
        <div className={styles.nextClassHeaderRow}>
          <span
            className={styles.courseBadgeDot}
            style={{ background: occurrence.courseColor ?? "var(--accent)" }}
            aria-hidden="true"
          />
          <strong className={styles.nextClassCode}>{occurrence.courseCode}</strong>
          <Badge
            tone={isInProgress ? "accent" : "neutral"}
            size="sm"
          >
            {isInProgress ? "In progress" : "Upcoming"}
          </Badge>
        </div>

        <h4 className={styles.nextClassTitle}>{occurrence.courseName}</h4>

        <div className={styles.nextClassMetaList}>
          <div className={styles.nextClassMetaItem}>
            <Clock size={13} aria-hidden="true" />
            <span>{occurrence.timeRangeFormatted}</span>
          </div>
          {occurrence.location ? (
            <div className={styles.nextClassMetaItem}>
              <MapPin size={13} aria-hidden="true" />
              <span>{occurrence.location}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

