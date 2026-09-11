"use client";

import { useMemo, useState } from "react";
import { Calendar, Clock, MapPin } from "lucide-react";
import type { CourseWithMeetings, PersistedCourseMeeting } from "@/types/course";
import { Badge } from "@/components/ui/badge";
import styles from "./school-timetable-view.module.css";

const ALL_WEEKDAYS = [
  { index: 1, short: "Mon", full: "Monday" },
  { index: 2, short: "Tue", full: "Tuesday" },
  { index: 3, short: "Wed", full: "Wednesday" },
  { index: 4, short: "Thu", full: "Thursday" },
  { index: 5, short: "Fri", full: "Friday" },
  { index: 6, short: "Sat", full: "Saturday" },
  { index: 0, short: "Sun", full: "Sunday" },
];

type TimetableMeetingItem = PersistedCourseMeeting & {
  courseCode: string;
  courseName: string;
  courseColor: string | null;
};

type SchoolTimetableViewProps = {
  courses: CourseWithMeetings[];
  today: string;
  timeZone: string;
  onSelectCourse: (courseId: string) => void;
};

function getTodayDayIndex(todayDate: string): number {
  try {
    const [year, month, day] = todayDate.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  } catch {
    return new Date().getDay();
  }
}

function formatMeetingTime(timeStr: string): string {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  const displayM = m < 10 ? `0${m}` : m;
  return `${displayH}:${displayM} ${period}`;
}

export function SchoolTimetableView({
  courses,
  today,
  timeZone: _timeZone,
  onSelectCourse,
}: SchoolTimetableViewProps) {
  const todayDayIndex = useMemo(() => getTodayDayIndex(today), [today]);

  // Group all meetings by weekday
  const meetingsByDay = useMemo(() => {
    const map = new Map<number, TimetableMeetingItem[]>();
    for (let i = 0; i <= 6; i++) {
      map.set(i, []);
    }

    for (const course of courses) {
      if (course.archivedAt) continue;
      for (const meeting of course.meetings) {
        for (const day of meeting.weekdays) {
          const list = map.get(day) ?? [];
          list.push({
            ...meeting,
            courseCode: course.code,
            courseName: course.name,
            courseColor: course.color,
          });
          map.set(day, list);
        }
      }
    }

    // Sort each day's meetings chronologically by start time
    for (const [day, list] of map.entries()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(day, list);
    }

    return map;
  }, [courses]);

  // Check if weekend meetings exist
  const hasWeekendMeetings = useMemo(() => {
    const sunMeetings = meetingsByDay.get(0)?.length ?? 0;
    const satMeetings = meetingsByDay.get(6)?.length ?? 0;
    return sunMeetings > 0 || satMeetings > 0;
  }, [meetingsByDay]);

  // Active days to display
  const displayDays = useMemo(() => {
    if (hasWeekendMeetings) {
      return ALL_WEEKDAYS;
    }
    // Monday through Friday
    return ALL_WEEKDAYS.slice(0, 5);
  }, [hasWeekendMeetings]);

  // Mobile selected day
  const [selectedMobileDay, setSelectedMobileDay] = useState<number>(todayDayIndex);

  const selectedDayMeetings = meetingsByDay.get(selectedMobileDay) ?? [];
  const selectedDayInfo = ALL_WEEKDAYS.find((d) => d.index === selectedMobileDay) ?? ALL_WEEKDAYS[0];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.title}>Weekly Timetable</h3>
          <p className={styles.subtitle}>
            Recurring class schedule and lecture locations across your active courses
          </p>
        </div>
      </div>

      {/* Desktop Column Grid */}
      <div
        className={styles.desktopGrid}
        style={
          {
            "--day-columns": displayDays.length,
          } as React.CSSProperties
        }
      >
        {displayDays.map((day) => {
          const meetings = meetingsByDay.get(day.index) ?? [];
          const isToday = day.index === todayDayIndex;

          return (
            <div key={day.index} className={styles.dayColumn}>
              <div
                className={styles.dayColumnHeader}
                data-is-today={isToday || undefined}
              >
                <span className={styles.dayLabel}>
                  {day.short}
                  {isToday ? " (Today)" : ""}
                </span>
                <span className={styles.dayMeetingCount}>
                  {meetings.length}
                </span>
              </div>

              {meetings.length > 0 ? (
                <ul className={styles.meetingsList}>
                  {meetings.map((meeting) => (
                    <li
                      key={meeting.id}
                      className={styles.meetingCard}
                      style={
                        {
                          "--meeting-course-accent":
                            meeting.courseColor ?? "var(--accent)",
                        } as React.CSSProperties
                      }
                      onClick={() => onSelectCourse(meeting.courseId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectCourse(meeting.courseId);
                        }
                      }}
                      aria-label={`${meeting.courseCode}: ${meeting.title} at ${formatMeetingTime(meeting.startTime)}`}
                    >
                      <div className={styles.meetingTop}>
                        <span className={styles.meetingCourse}>
                          {meeting.courseCode}
                        </span>
                        <span className={styles.meetingTime}>
                          {formatMeetingTime(meeting.startTime)}–{formatMeetingTime(meeting.endTime)}
                        </span>
                      </div>

                      <p className={styles.meetingTitle}>{meeting.title}</p>

                      {meeting.location ? (
                        <span className={styles.meetingLocation}>
                          <MapPin size={11} aria-hidden="true" />
                          <span>{meeting.location}</span>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.emptyDay}>No classes</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile View: Weekday Selector + Single Day Agenda */}
      <div className={styles.mobileView}>
        <div
          className={styles.weekdaySelector}
          role="tablist"
          aria-label="Select day of week"
        >
          {displayDays.map((day) => {
            const isSelected = day.index === selectedMobileDay;
            const isToday = day.index === todayDayIndex;
            const count = meetingsByDay.get(day.index)?.length ?? 0;

            return (
              <button
                key={day.index}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={styles.weekdayPill}
                data-selected={isSelected || undefined}
                onClick={() => setSelectedMobileDay(day.index)}
              >
                <span className={styles.weekdayPillDay}>
                  {day.short}
                </span>
                {count > 0 ? (
                  <span
                    className={styles.weekdayPillDot}
                    title={`${count} classes`}
                    aria-hidden="true"
                  />
                ) : null}
                {isToday ? (
                  <span style={{ fontSize: "0.6rem", fontWeight: 700, marginTop: "0.15rem" }}>
                    Today
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className={styles.mobileDayHeader}>
          <h4 className={styles.mobileDayTitle}>
            {selectedDayInfo.full}
            {selectedMobileDay === todayDayIndex ? " (Today)" : ""}
          </h4>
          <Badge variant="subtle" size="sm">
            {selectedDayMeetings.length}{" "}
            {selectedDayMeetings.length === 1 ? "class" : "classes"}
          </Badge>
        </div>

        {selectedDayMeetings.length > 0 ? (
          <ul className={styles.mobileMeetingsList}>
            {selectedDayMeetings.map((meeting) => (
              <li
                key={meeting.id}
                className={styles.meetingCard}
                style={
                  {
                    "--meeting-course-accent":
                      meeting.courseColor ?? "var(--accent)",
                  } as React.CSSProperties
                }
                onClick={() => onSelectCourse(meeting.courseId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectCourse(meeting.courseId);
                  }
                }}
                aria-label={`${meeting.courseCode}: ${meeting.title} at ${formatMeetingTime(meeting.startTime)}`}
              >
                <div className={styles.meetingTop}>
                  <span className={styles.meetingCourse}>
                    {meeting.courseCode} · {meeting.courseName}
                  </span>
                  <span className={styles.meetingTime}>
                    <Clock size={11} aria-hidden="true" />
                    <span>
                      {formatMeetingTime(meeting.startTime)}–{formatMeetingTime(meeting.endTime)}
                    </span>
                  </span>
                </div>

                <p className={styles.meetingTitle}>{meeting.title}</p>

                {meeting.location ? (
                  <span className={styles.meetingLocation}>
                    <MapPin size={12} aria-hidden="true" />
                    <span>{meeting.location}</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.emptyMobileDay}>
            <Calendar size={18} aria-hidden="true" />
            <span>No classes scheduled for {selectedDayInfo.full}.</span>
          </div>
        )}
      </div>
    </div>
  );
}
