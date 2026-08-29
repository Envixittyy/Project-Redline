"use client";

import { BookOpen, CalendarClock, Check, ChevronLeft, ChevronRight, CircleDot, Clock3, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { TaskEditor } from "@/features/tasks/task-editor";
import type { CalendarEvent } from "@/types/calendar-event";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

import type { CalendarItem } from "./calendar-items";
import { eachDay, shiftCalendarAnchor, type CalendarView } from "./calendar-date";
import { EventEditor } from "./event-editor";
import { WorkSessionEditor } from "./work-session-editor";
import styles from "./calendar-workspace.module.css";

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CalendarWorkspaceProps = {
  view: CalendarView;
  anchor: string;
  heading: string;
  fromDate: string;
  toDateExclusive: string;
  today: string;
  timeZone: string;
  items: CalendarItem[];
  taskOptions: Array<{ id: string; title: string }>;
};

function calendarHref(view: CalendarView, date: string) {
  return `/calendar?view=${view}&date=${date}`;
}

function formatDay(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

function formatTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

function itemTitle(item: CalendarItem): string {
  if (item.kind === "event") return item.event.title;
  if (item.kind === "course_meeting") return item.meeting.title;
  return item.task.title;
}

function itemMeta(item: CalendarItem, timeZone: string): string {
  if (item.kind === "deadline") return "Due";
  if (item.kind === "course_meeting") return `${formatTime(item.entry.start!, timeZone)}–${formatTime(item.entry.end!, timeZone)} · ${item.entry.courseLabel}`;
  if (item.kind === "event") {
    if (item.event.allDay) return "All day";
    return `${formatTime(item.event.start, timeZone)}–${formatTime(item.event.end, timeZone)}`;
  }
  if (item.kind === "work_session") {
    return `${formatTime(item.workSession.startsAt, timeZone)}–${formatTime(item.workSession.endsAt, timeZone)}`;
  }

  if (!item.task.scheduledStart) return "Scheduled task";
  const start = formatTime(item.task.scheduledStart, timeZone);
  return item.task.scheduledEnd
    ? `${start}–${formatTime(item.task.scheduledEnd, timeZone)}`
    : start;
}

function CalendarItemButton({
  item,
  timeZone,
  compact = false,
  onOpenEvent,
  onOpenTask,
  onOpenWorkSession,
}: {
  item: CalendarItem;
  timeZone: string;
  compact?: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTask: (task: Task) => void;
  onOpenWorkSession: (session: WorkSession) => void;
}) {
  const task = item.kind === "deadline" || item.kind === "scheduled_task" || item.kind === "work_session" ? item.task : null;
  const completed = task?.status === "completed";

  return (
    <button
      type="button"
      className={styles.item}
      data-kind={item.kind}
      data-completed={completed || undefined}
      onClick={() => {
        if (item.kind === "event") onOpenEvent(item.event);
        else if (item.kind === "work_session") onOpenWorkSession(item.workSession);
        else if (item.kind !== "course_meeting") onOpenTask(item.task);
      }}
      title={`${itemTitle(item)} · ${itemMeta(item, timeZone)}`}
    >
      <span className={styles.itemIcon} aria-hidden="true">
        {item.kind === "course_meeting" ? <BookOpen size={compact ? 10 : 13}/> : item.kind === "event" ? <CircleDot size={compact ? 10 : 13} /> : item.kind === "deadline" ? <CalendarClock size={compact ? 10 : 13} /> : completed ? <Check size={compact ? 10 : 13} /> : <Clock3 size={compact ? 10 : 13} />}
      </span>
      <span className={styles.itemCopy}>
        {!compact ? <span className={styles.itemMeta}>{itemMeta(item, timeZone)}</span> : null}
        <span className={styles.itemTitle}>{itemTitle(item)}</span>
      </span>
    </button>
  );
}

export function CalendarWorkspace({
  view,
  anchor,
  heading,
  fromDate,
  toDateExclusive,
  today,
  timeZone,
  items,
  taskOptions,
}: CalendarWorkspaceProps) {
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newEventDate, setNewEventDate] = useState<string | null>(null);
  const [editingWorkSession, setEditingWorkSession] = useState<WorkSession | null>(null);
  const [newWorkSessionDate, setNewWorkSessionDate] = useState<string | null>(null);

  const days = useMemo(() => eachDay(fromDate, toDateExclusive), [fromDate, toDateExclusive]);
  const grouped = useMemo(() => {
    const byDate = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const group = byDate.get(item.date) ?? [];
      group.push(item);
      byDate.set(item.date, group);
    }
    return byDate;
  }, [items]);

  const previous = shiftCalendarAnchor(view, anchor, -1);
  const next = shiftCalendarAnchor(view, anchor, 1);
  const eventDate = newEventDate ?? anchor;
  const workSessionDate = newWorkSessionDate ?? anchor;

  const openEvent = (event: CalendarEvent) => setEditingEvent(event);
  const openTask = (task: Task) => setEditingTask(task);
  const openWorkSession = (session: WorkSession) => setEditingWorkSession(session);

  return (
    <section className={styles.workspace} aria-label="Calendar">
      <div className={styles.toolbar}>
        <div className={styles.periodControls}>
          <Link className={styles.iconLink} href={calendarHref(view, previous)} aria-label="Previous period">
            <ChevronLeft size={19} aria-hidden="true" />
          </Link>
          <Link className={styles.todayLink} href={calendarHref(view, today)}>Today</Link>
          <Link className={styles.iconLink} href={calendarHref(view, next)} aria-label="Next period">
            <ChevronRight size={19} aria-hidden="true" />
          </Link>
          <h2>{heading}</h2>
        </div>

        <div className={styles.toolbarActions}>
          <nav className={styles.viewSwitcher} aria-label="Calendar view">
            {(["month", "week", "agenda"] as const).map((candidate) => (
              <Link key={candidate} href={calendarHref(candidate, anchor)} data-active={candidate === view || undefined}>
                {candidate[0].toUpperCase() + candidate.slice(1)}
              </Link>
            ))}
          </nav>
          <button type="button" className={styles.secondaryAddButton} onClick={() => setNewWorkSessionDate(anchor)}>
            <Clock3 size={17} aria-hidden="true" /> <span>Plan work</span>
          </button>
          <button type="button" className={styles.addButton} aria-label="New event" onClick={() => setNewEventDate(anchor)}>
            <Plus size={17} aria-hidden="true" /> <span>New event</span>
          </button>
        </div>
      </div>

      <div className={styles.legend} aria-label="Calendar item legend">
        <span data-kind="course_meeting"><BookOpen size={12}/> Course meeting</span>
        <span data-kind="event"><CircleDot size={12} /> Event</span>
        <span data-kind="work_session"><Clock3 size={12} /> Task work session</span>
        <span data-kind="scheduled_task"><Clock3 size={12} /> Scheduled task</span>
        <span data-kind="deadline"><CalendarClock size={12} /> Due-only deadline</span>
      </div>

      {view === "month" ? (
        <div className={styles.monthLayout}>
          <div className={styles.monthFrame}>
            <div className={styles.weekdayRow} aria-hidden="true">
              {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className={styles.monthGrid}>
              {days.map((date) => {
                const dayItems = grouped.get(date) ?? [];
                const outsideMonth = date.slice(0, 7) !== anchor.slice(0, 7);
                return (
                  <section key={date} className={styles.monthDay} data-outside={outsideMonth || undefined} data-today={date === today || undefined}>
                    <button type="button" className={styles.dayNumber} onClick={() => setNewEventDate(date)} aria-label={`Create event on ${formatDay(date, { dateStyle: "full" })}`}>
                      {formatDay(date, { day: "numeric" })}
                    </button>
                    <div className={styles.monthItems}>
                      {dayItems.slice(0, 3).map((item) => (
                        <CalendarItemButton key={item.key} item={item} timeZone={timeZone} compact onOpenEvent={openEvent} onOpenTask={openTask} onOpenWorkSession={openWorkSession} />
                      ))}
                      {dayItems.length > 3 ? <span className={styles.moreCount}>+{dayItems.length - 3} more</span> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
          <div className={styles.mobileMonthDetails} aria-label="Month details">
            {days.filter((date) => (grouped.get(date)?.length ?? 0) > 0).map((date) => (
              <section key={date} className={styles.mobileDetailDay}>
                <h3>{formatDay(date, { weekday: "short", month: "short", day: "numeric" })}</h3>
                <div>
                  {(grouped.get(date) ?? []).map((item) => (
                    <CalendarItemButton key={`mobile:${item.key}`} item={item} timeZone={timeZone} onOpenEvent={openEvent} onOpenTask={openTask} onOpenWorkSession={openWorkSession} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {view === "week" ? (
        <div className={styles.weekScroller} tabIndex={0} aria-label="Scrollable week">
          <div className={styles.weekGrid}>
            {days.map((date, index) => (
              <section key={date} className={styles.weekDay} data-today={date === today || undefined}>
                <header>
                  <span>{weekdayLabels[index]}</span>
                  <button type="button" onClick={() => setNewEventDate(date)} aria-label={`Create event on ${formatDay(date, { dateStyle: "full" })}`}>
                    {formatDay(date, { day: "numeric" })}
                  </button>
                </header>
                <div className={styles.weekItems}>
                  {(grouped.get(date) ?? []).map((item) => (
                    <CalendarItemButton key={item.key} item={item} timeZone={timeZone} onOpenEvent={openEvent} onOpenTask={openTask} onOpenWorkSession={openWorkSession} />
                  ))}
                  {(grouped.get(date) ?? []).length === 0 ? <p className={styles.clearDay}>Clear</p> : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {view === "agenda" ? (
        <div className={styles.agenda}>
          {days.filter((date) => (grouped.get(date)?.length ?? 0) > 0).map((date) => (
            <section key={date} className={styles.agendaDay} data-today={date === today || undefined}>
              <header>
                <div>
                  <span>{formatDay(date, { weekday: "long" })}</span>
                  <strong>{formatDay(date, { month: "short", day: "numeric" })}</strong>
                </div>
                <button type="button" onClick={() => setNewEventDate(date)} aria-label={`Create event on ${formatDay(date, { dateStyle: "full" })}`}>
                  <Plus size={16} aria-hidden="true" />
                </button>
              </header>
              <div className={styles.agendaItems}>
                {(grouped.get(date) ?? []).map((item) => (
                  <CalendarItemButton key={item.key} item={item} timeZone={timeZone} onOpenEvent={openEvent} onOpenTask={openTask} onOpenWorkSession={openWorkSession} />
                ))}
              </div>
            </section>
          ))}
          {items.length === 0 ? <div className={styles.emptyAgenda}><CalendarClock size={22} /><p>No course meetings, events, scheduled tasks, or due-only deadlines in this window.</p></div> : null}
        </div>
      ) : null}

      {newEventDate !== null || editingEvent ? (
        <EventEditor
          key={editingEvent?.id ?? `new:${eventDate}`}
          event={editingEvent}
          initialDate={eventDate}
          timeZone={timeZone}
          onClose={() => { setEditingEvent(null); setNewEventDate(null); }}
        />
      ) : null}

      {editingTask ? (
        <TaskEditor key={editingTask.id} task={editingTask} timeZone={timeZone} onClose={() => setEditingTask(null)} />
      ) : null}

      {newWorkSessionDate !== null || editingWorkSession ? (
        <WorkSessionEditor
          key={editingWorkSession?.id ?? `new-work:${workSessionDate}`}
          session={editingWorkSession}
          initialDate={workSessionDate}
          taskOptions={taskOptions}
          timeZone={timeZone}
          onClose={() => {
            setEditingWorkSession(null);
            setNewWorkSessionDate(null);
          }}
        />
      ) : null}
    </section>
  );
}
