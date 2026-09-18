"use client";

import {
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Clock3,
  Info,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { SegmentedControl, type SegmentOption } from "@/components/ui/segmented-control";
import { Surface } from "@/components/ui/surface";
import { TaskEditor } from "@/features/tasks/task-editor";
import { addDays } from "@/lib/date/day";
import type { CalendarEvent } from "@/types/calendar-event";
import type { ExternalCalendarProjection } from "@/types/external-calendar";
import type { Task } from "@/types/task";
import type { WorkSession } from "@/types/work-session";

import {
  eachDay,
  shiftCalendarAnchor,
  weekDaysForAnchor,
  type CalendarView,
} from "./calendar-date";
import {
  buildExternalCalendarItems,
  sortCalendarItemsChronologically,
  type CalendarItem,
} from "./calendar-items";
import { EventEditor } from "./event-editor";
import { WorkSessionEditor } from "./work-session-editor";
import styles from "./calendar-workspace.module.css";

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayInitials = ["M", "T", "W", "T", "F", "S", "S"];

const viewOptions: Array<SegmentOption<CalendarView>> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "agenda", label: "Agenda" },
];

export type CalendarWorkspaceProps = {
  view: CalendarView;
  anchor: string;
  heading: string;
  fromDate: string;
  toDateExclusive: string;
  today: string;
  timeZone: string;
  items: CalendarItem[];
  taskOptions?: Array<{ id: string; title: string }>;
  externalEventsPromise?: Promise<ExternalCalendarProjection[]>;
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
  if (item.kind === "external_event") return item.externalEvent.title;
  if (item.kind === "course_meeting") return item.meeting.title;
  if (item.kind === "assessment_prediction") return `◇ Possible ${item.prediction.title}`;
  return item.task.title;
}

function itemTiming(item: CalendarItem, timeZone: string): string {
  if (item.kind === "deadline") {
    if (item.entry.duePrecision === "date" || !item.entry.start) return "Due";
    return `Due ${formatTime(item.entry.start, timeZone)}`;
  }
  if (item.kind === "event") {
    if (item.event.allDay) return "All day";
    return `${formatTime(item.event.start, timeZone)}–${formatTime(item.event.end, timeZone)}`;
  }
  if (item.kind === "external_event") {
    if (item.externalEvent.allDay) return "All day";
    return `${formatTime(item.externalEvent.startsAt, timeZone)}–${formatTime(item.externalEvent.endsAt, timeZone)}`;
  }
  if (item.kind === "course_meeting") {
    return `${formatTime(item.entry.start!, timeZone)}–${formatTime(item.entry.end!, timeZone)}`;
  }
  if (item.kind === "work_session") {
    return `${formatTime(item.workSession.startsAt, timeZone)}–${formatTime(item.workSession.endsAt, timeZone)}`;
  }
  if (item.kind === "scheduled_task") {
    if (!item.task.scheduledStart) return "Scheduled";
    const start = formatTime(item.task.scheduledStart, timeZone);
    return item.task.scheduledEnd ? `${start}–${formatTime(item.task.scheduledEnd, timeZone)}` : start;
  }
  if (item.kind === "assessment_prediction") {
    return "Predicted";
  }
  return "";
}

function itemContext(item: CalendarItem): string {
  if (item.kind === "course_meeting") {
    return item.entry.courseLabel ?? "Course meeting";
  }
  if (item.kind === "external_event") {
    const provider =
      item.externalEvent.provider === "microsoft"
        ? "Outlook"
        : item.externalEvent.provider === "google"
          ? "Google Calendar"
          : item.externalEvent.provider;
    return item.entry.courseLabel ? `${provider} · ${item.entry.courseLabel}` : provider;
  }
  if (item.kind === "deadline") {
    return item.entry.courseLabel ? `${item.entry.courseLabel} · Deadline` : "Deadline";
  }
  if (item.kind === "scheduled_task") {
    return item.entry.courseLabel ? `${item.entry.courseLabel} · Scheduled task` : "Scheduled task";
  }
  if (item.kind === "work_session") {
    return item.entry.courseLabel ? `${item.entry.courseLabel} · Task work session` : "Task work session";
  }
  if (item.kind === "assessment_prediction") {
    return `Confidence: ${item.prediction.confidence}`;
  }
  if (item.kind === "event") {
    return item.event.course ? item.event.course : "Personal event";
  }
  return "";
}

function itemMeta(item: CalendarItem, timeZone: string): string {
  if (item.kind === "deadline") return "Due";
  if (item.kind === "course_meeting") return `${formatTime(item.entry.start!, timeZone)}–${formatTime(item.entry.end!, timeZone)} · ${item.entry.courseLabel}`;
  if (item.kind === "assessment_prediction") return `Possible · ${item.prediction.confidence}`;
  if (item.kind === "event") {
    if (item.event.allDay) return "All day";
    return `${formatTime(item.event.start, timeZone)}–${formatTime(item.event.end, timeZone)}`;
  }
  if (item.kind === "external_event") {
    const provider =
      item.externalEvent.provider === "microsoft"
        ? "Outlook"
        : item.externalEvent.provider === "google"
          ? "Google Calendar"
          : item.externalEvent.provider;
    if (item.externalEvent.allDay) return `All day · ${provider}`;
    return `${formatTime(item.externalEvent.startsAt, timeZone)}–${formatTime(item.externalEvent.endsAt, timeZone)} · ${provider}`;
  }
  if (item.kind === "work_session") {
    return `${formatTime(item.workSession.startsAt, timeZone)}–${formatTime(item.workSession.endsAt, timeZone)}`;
  }
  if (item.kind === "scheduled_task") {
    if (!item.task.scheduledStart) return "Scheduled task";
    const start = formatTime(item.task.scheduledStart, timeZone);
    return item.task.scheduledEnd
      ? `${start}–${formatTime(item.task.scheduledEnd, timeZone)}`
      : start;
  }
  return "";
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
  const courseColor = item.entry.courseColor;

  return (
    <button
      type="button"
      className={styles.item}
      data-kind={item.kind}
      data-completed={completed || undefined}
      onClick={() => {
        if (item.kind === "event") onOpenEvent(item.event);
        else if (item.kind === "work_session") onOpenWorkSession(item.workSession);
        else if (item.kind === "deadline" || item.kind === "scheduled_task") onOpenTask(item.task);
      }}
      title={`${itemTitle(item)} · ${itemMeta(item, timeZone)}`}
      style={courseColor ? ({ "--calendar-item-accent": courseColor } as React.CSSProperties) : undefined}
    >
      <span className={styles.itemIcon} aria-hidden="true">
        {item.kind === "course_meeting" ? (
          <BookOpen size={compact ? 10 : 13} />
        ) : item.kind === "event" || item.kind === "external_event" ? (
          <CircleDot size={compact ? 10 : 13} />
        ) : item.kind === "deadline" ? (
          <CalendarClock size={compact ? 10 : 13} />
        ) : completed ? (
          <Check size={compact ? 10 : 13} />
        ) : (
          <Clock3 size={compact ? 10 : 13} />
        )}
      </span>
      <span className={styles.itemCopy}>
        {!compact ? <span className={styles.itemMeta}>{itemMeta(item, timeZone)}</span> : null}
        <span className={styles.itemTitle}>{itemTitle(item)}</span>
      </span>
    </button>
  );
}

function AgendaScheduleItem({
  item,
  timeZone,
  onOpenEvent,
  onOpenTask,
  onOpenWorkSession,
}: {
  item: CalendarItem;
  timeZone: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTask: (task: Task) => void;
  onOpenWorkSession: (session: WorkSession) => void;
}) {
  const task = item.kind === "deadline" || item.kind === "scheduled_task" || item.kind === "work_session" ? item.task : null;
  const completed = task?.status === "completed";
  const isInteractive = item.kind === "event" || item.kind === "work_session" || item.kind === "deadline" || item.kind === "scheduled_task";
  const courseColor = item.entry.courseColor;
  const timing = itemTiming(item, timeZone);
  const context = itemContext(item);

  return (
    <button
      type="button"
      className={styles.agendaItem}
      data-kind={item.kind}
      data-completed={completed || undefined}
      data-interactive={isInteractive || undefined}
      onClick={() => {
        if (item.kind === "event") onOpenEvent(item.event);
        else if (item.kind === "work_session") onOpenWorkSession(item.workSession);
        else if (item.kind === "deadline" || item.kind === "scheduled_task") onOpenTask(item.task);
      }}
      aria-label={`${itemTitle(item)} · ${timing}${context ? ` · ${context}` : ""}`}
    >
      <div className={styles.agendaItemTimeCol}>
        <span className={styles.agendaItemTime}>{timing}</span>
      </div>

      <div className={styles.agendaItemIndicatorCol} aria-hidden="true">
        <span
          className={styles.agendaItemDot}
          data-kind={item.kind}
          style={courseColor ? { backgroundColor: courseColor } : undefined}
        />
      </div>

      <div className={styles.agendaItemContentCol}>
        <div className={styles.agendaItemHeaderRow}>
          <span className={styles.agendaItemTitle}>{itemTitle(item)}</span>
          {item.kind === "deadline" && item.entry.overdue ? (
            <Badge tone="destructive" size="sm">Overdue</Badge>
          ) : completed ? (
            <Badge tone="success" size="sm">Completed</Badge>
          ) : null}
        </div>

        {context ? (
          <div className={styles.agendaItemMetaRow}>
            {courseColor ? (
              <span
                className={styles.metaCourseDot}
                style={{ backgroundColor: courseColor }}
                aria-hidden="true"
              />
            ) : null}
            <span className={styles.agendaItemContext}>{context}</span>
          </div>
        ) : null}
      </div>
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
  items: initialItems,
  taskOptions = [],
  externalEventsPromise,
}: CalendarWorkspaceProps) {
  const router = useRouter();
  const [extraExternalItems, setExtraExternalItems] = useState<CalendarItem[]>([]);

  useEffect(() => {
    if (!externalEventsPromise) return;
    let active = true;
    externalEventsPromise.then((externalEvents) => {
      if (!active || !externalEvents || externalEvents.length === 0) return;
      const externalItems = buildExternalCalendarItems(
        externalEvents,
        timeZone,
        fromDate,
        toDateExclusive,
      );
      if (externalItems.length > 0) {
        setExtraExternalItems(externalItems);
      }
    });
    return () => {
      active = false;
    };
  }, [externalEventsPromise, fromDate, toDateExclusive, timeZone]);

  const items = useMemo(() => {
    if (extraExternalItems.length === 0) return initialItems;
    const existingKeys = new Set(initialItems.map((item) => item.key));
    const additions = extraExternalItems.filter((item) => !existingKeys.has(item.key));
    return additions.length > 0 ? [...initialItems, ...additions] : initialItems;
  }, [initialItems, extraExternalItems]);

  const [selectedDate, setSelectedDate] = useState<string>(anchor);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newEventDate, setNewEventDate] = useState<string | null>(null);
  const [editingWorkSession, setEditingWorkSession] = useState<WorkSession | null>(null);
  const [newWorkSessionDate, setNewWorkSessionDate] = useState<string | null>(null);

  const days = useMemo(() => eachDay(fromDate, toDateExclusive), [fromDate, toDateExclusive]);
  const weekDays = useMemo(() => weekDaysForAnchor(selectedDate), [selectedDate]);

  const grouped = useMemo(() => {
    const byDate = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const group = byDate.get(item.date) ?? [];
      group.push(item);
      byDate.set(item.date, group);
    }
    return byDate;
  }, [items]);

  const selectedDayItems = useMemo(() => {
    return sortCalendarItemsChronologically(grouped.get(selectedDate) ?? []);
  }, [grouped, selectedDate]);

  const previous = shiftCalendarAnchor(view, anchor, -1);
  const next = shiftCalendarAnchor(view, anchor, 1);
  const eventDate = newEventDate ?? selectedDate ?? anchor;
  const workSessionDate = newWorkSessionDate ?? selectedDate ?? anchor;

  const openEvent = (event: CalendarEvent) => setEditingEvent(event);
  const openTask = (task: Task) => setEditingTask(task);
  const openWorkSession = (session: WorkSession) => setEditingWorkSession(session);

  const handleViewChange = (newView: CalendarView) => {
    if (router) {
      router.push(calendarHref(newView, selectedDate));
    }
  };

  const handlePrevWeek = () => {
    setSelectedDate((current) => addDays(current, -7));
  };

  const handleNextWeek = () => {
    setSelectedDate((current) => addDays(current, 7));
  };

  return (
    <section className={styles.workspace} aria-label="Calendar">
      {/* Consolidated Toolbar */}
      <div className={styles.toolbar}>
        {/* Primary Row: Heading + Actions (Desktop single row, Mobile Row 1) */}
        <div className={styles.toolbarPrimary}>
          <div className={styles.headingWrap}>
            {/* Mobile Heading with Month Picker Toggle */}
            <button
              type="button"
              className={styles.mobileHeadingToggle}
              onClick={() => {
                if (view === "month") {
                  setIsMonthPickerOpen(!isMonthPickerOpen);
                }
              }}
              aria-expanded={view === "month" ? isMonthPickerOpen : undefined}
              aria-label={
                view === "month"
                  ? `${heading}. Tap to ${isMonthPickerOpen ? "collapse" : "expand"} month picker.`
                  : heading
              }
            >
              <h2>{heading}</h2>
              {view === "month" ? (
                isMonthPickerOpen ? (
                  <ChevronUp size={16} aria-hidden="true" className={styles.headingChevron} />
                ) : (
                  <ChevronDown size={16} aria-hidden="true" className={styles.headingChevron} />
                )
              ) : null}
            </button>

            {/* Desktop Period Controls + Heading */}
            <div className={styles.desktopPeriodAndHeading}>
              <div className={styles.periodControls}>
                <Link
                  className={styles.iconLink}
                  href={calendarHref(view, previous)}
                  aria-label="Previous period"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </Link>
                <Link className={styles.todayLink} href={calendarHref(view, today)}>
                  Today
                </Link>
                <Link
                  className={styles.iconLink}
                  href={calendarHref(view, next)}
                  aria-label="Next period"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </div>
              <h2 className={styles.desktopHeading}>{heading}</h2>
            </div>
          </div>

          <div className={styles.actionControls}>
            <Popover
              isOpen={isLegendOpen}
              onClose={() => setIsLegendOpen(false)}
              placement="bottom-end"
              ariaLabel="Calendar item legend"
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Info size={16} />}
                  iconOnly
                  aria-label="Calendar legend"
                  onClick={() => setIsLegendOpen(!isLegendOpen)}
                  className={styles.legendTrigger}
                />
              }
            >
              <div className={styles.legendPopover}>
                <div className={styles.legendPopoverHeader}>
                  <h4>Calendar Legend</h4>
                </div>
                <ul className={styles.legendList}>
                  <li>
                    <span className={styles.legendDot} data-kind="course_meeting">
                      <BookOpen size={12} aria-hidden="true" />
                    </span>
                    <span>Course meeting</span>
                  </li>
                  <li>
                    <span className={styles.legendDot} data-kind="event">
                      <CircleDot size={12} aria-hidden="true" />
                    </span>
                    <span>Event</span>
                  </li>
                  <li>
                    <span className={styles.legendDot} data-kind="external_event">
                      <CircleDot size={12} aria-hidden="true" />
                    </span>
                    <span>External event</span>
                  </li>
                  <li>
                    <span className={styles.legendDot} data-kind="work_session">
                      <Clock3 size={12} aria-hidden="true" />
                    </span>
                    <span>Task work session</span>
                  </li>
                  <li>
                    <span className={styles.legendDot} data-kind="scheduled_task">
                      <Clock3 size={12} aria-hidden="true" />
                    </span>
                    <span>Scheduled task</span>
                  </li>
                  <li>
                    <span className={styles.legendDot} data-kind="deadline">
                      <CalendarClock size={12} aria-hidden="true" />
                    </span>
                    <span>Due-only deadline</span>
                  </li>
                </ul>
              </div>
            </Popover>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Clock3 size={16} />}
              onClick={() => setNewWorkSessionDate(selectedDate)}
              aria-label="Plan work"
              className={styles.planWorkButton}
            >
              <span className={styles.buttonLabel}>Plan work</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={<Plus size={16} />}
              onClick={() => setNewEventDate(selectedDate)}
              aria-label="New event"
              className={styles.newEventButton}
            >
              <span className={styles.buttonLabel}>New event</span>
            </Button>
          </div>
        </div>

        {/* Secondary Row: Period Navigation (Mobile only) + View Switcher */}
        <div className={styles.secondaryNavRow}>
          <div className={styles.mobilePeriodControls}>
            <Link
              className={styles.iconLink}
              href={calendarHref(view, previous)}
              aria-label="Previous period"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </Link>
            <Link className={styles.todayLink} href={calendarHref(view, today)}>
              Today
            </Link>
            <Link
              className={styles.iconLink}
              href={calendarHref(view, next)}
              aria-label="Next period"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </div>

          <SegmentedControl
            options={viewOptions}
            value={view}
            onChange={handleViewChange}
            ariaLabel="Calendar view"
            className={styles.viewSwitcher}
          />
        </div>
      </div>

      {/* MONTH VIEW */}
      {view === "month" ? (
        <div className={styles.monthContainer}>
          {/* Mobile Agenda-First Surface (< 768px) */}
          <div className={styles.mobileMonthLayout}>
            {/* 7-Day Compact Week Strip */}
            <div className={styles.mobileWeekStripContainer}>
              <button
                type="button"
                className={styles.stripNavButton}
                onClick={handlePrevWeek}
                aria-label="Previous week"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>

              <div className={styles.mobileWeekStrip} role="grid" aria-label="Week dates">
                {weekDays.map((date, idx) => {
                  const dayItems = grouped.get(date) ?? [];
                  const isToday = date === today;
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      key={date}
                      type="button"
                      className={styles.stripDay}
                      data-today={isToday || undefined}
                      data-selected={isSelected || undefined}
                      onClick={() => setSelectedDate(date)}
                      aria-current={isSelected ? "date" : undefined}
                      aria-label={`${formatDay(date, {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}${isToday ? " (Today)" : ""}${
                        dayItems.length > 0 ? `, ${dayItems.length} item${dayItems.length > 1 ? "s" : ""}` : ""
                      }`}
                    >
                      <span className={styles.stripWeekday}>{weekdayInitials[idx]}</span>
                      <span className={styles.stripDayNumber}>
                        {formatDay(date, { day: "numeric" })}
                      </span>
                      <span className={styles.stripDots} aria-hidden="true">
                        {dayItems.slice(0, 3).map((it) => (
                          <span
                            key={it.key}
                            className={styles.stripDot}
                            data-kind={it.kind}
                            style={it.entry.courseColor ? { backgroundColor: it.entry.courseColor } : undefined}
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className={styles.stripNavButton}
                onClick={handleNextWeek}
                aria-label="Next week"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Expandable Mobile Month Picker */}
            {isMonthPickerOpen ? (
              <Surface variant="glass" className={styles.mobileMonthPicker}>
                <div className={styles.pickerHeader}>
                  <span className={styles.pickerTitle}>
                    {formatDay(anchor, { month: "long", year: "numeric" })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMonthPickerOpen(false)}
                    aria-label="Close month picker"
                  >
                    Close
                  </Button>
                </div>
                <div className={styles.pickerWeekdayRow} aria-hidden="true">
                  {weekdayLabels.map((lbl) => (
                    <span key={lbl}>{lbl[0]}</span>
                  ))}
                </div>
                <div className={styles.pickerGrid}>
                  {days.map((date) => {
                    const dayItems = grouped.get(date) ?? [];
                    const outsideMonth = date.slice(0, 7) !== anchor.slice(0, 7);
                    const isToday = date === today;
                    const isSelected = date === selectedDate;
                    return (
                      <button
                        key={`picker:${date}`}
                        type="button"
                        className={styles.pickerDay}
                        data-outside={outsideMonth || undefined}
                        data-today={isToday || undefined}
                        data-selected={isSelected || undefined}
                        onClick={() => {
                          setSelectedDate(date);
                          setIsMonthPickerOpen(false);
                        }}
                        aria-label={`${formatDay(date, { dateStyle: "full" })}${
                          isToday ? " (Today)" : ""
                        }`}
                      >
                        <span className={styles.pickerDayNum}>
                          {formatDay(date, { day: "numeric" })}
                        </span>
                        <span className={styles.pickerDots} aria-hidden="true">
                          {dayItems.slice(0, 3).map((it) => (
                            <span
                              key={it.key}
                              className={styles.pickerDot}
                              data-kind={it.kind}
                              style={it.entry.courseColor ? { backgroundColor: it.entry.courseColor } : undefined}
                            />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Surface>
            ) : null}

            {/* Selected Day Agenda Surface */}
            <div className={styles.selectedDayAgenda}>
              <header className={styles.agendaHeader}>
                <div className={styles.agendaHeaderTitle}>
                  <h3>
                    {formatDay(selectedDate, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </h3>
                  {selectedDate === today ? (
                    <Badge tone="accent" size="sm">
                      Today
                    </Badge>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={15} />}
                  onClick={() => setNewEventDate(selectedDate)}
                  aria-label={`Add event on ${formatDay(selectedDate, {
                    month: "short",
                    day: "numeric",
                  })}`}
                >
                  Add event
                </Button>
              </header>

              <div className={styles.agendaItemList}>
                {selectedDayItems.length === 0 ? (
                  <div className={styles.emptyDayNotice}>
                    <p className={styles.emptyDayTitle}>Nothing scheduled.</p>
                    <p className={styles.emptyDaySubtitle}>Your day is open.</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() => setNewEventDate(selectedDate)}
                    >
                      Add event
                    </Button>
                  </div>
                ) : (
                  selectedDayItems.map((item) => (
                    <AgendaScheduleItem
                      key={`selected:${item.key}`}
                      item={item}
                      timeZone={timeZone}
                      onOpenEvent={openEvent}
                      onOpenTask={openTask}
                      onOpenWorkSession={openWorkSession}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Desktop Full Month Grid (>= 768px) */}
          <div className={styles.desktopMonthFrame}>
            <div className={styles.weekdayRow} aria-hidden="true">
              {weekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className={styles.monthGrid}>
              {days.map((date) => {
                const dayItems = grouped.get(date) ?? [];
                const outsideMonth = date.slice(0, 7) !== anchor.slice(0, 7);
                const isToday = date === today;
                const isSelected = date === selectedDate;
                return (
                  <section
                    key={date}
                    className={styles.monthDay}
                    data-outside={outsideMonth || undefined}
                    data-today={isToday || undefined}
                    data-selected={isSelected || undefined}
                    onClick={() => setSelectedDate(date)}
                  >
                    <button
                      type="button"
                      className={styles.dayNumber}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDate(date);
                        setNewEventDate(date);
                      }}
                      aria-label={`Create event on ${formatDay(date, { dateStyle: "full" })}`}
                    >
                      {formatDay(date, { day: "numeric" })}
                    </button>
                    <div className={styles.monthItems}>
                      {dayItems.slice(0, 3).map((item) => (
                        <CalendarItemButton
                          key={item.key}
                          item={item}
                          timeZone={timeZone}
                          compact
                          onOpenEvent={openEvent}
                          onOpenTask={openTask}
                          onOpenWorkSession={openWorkSession}
                        />
                      ))}
                      {dayItems.length > 3 ? (
                        <span className={styles.moreCount}>+{dayItems.length - 3} more</span>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* WEEK VIEW */}
      {view === "week" ? (
        <div className={styles.weekContainer}>
          {/* Mobile Week View (< 768px): Strip + Timeline */}
          <div className={styles.mobileWeekLayout}>
            <div className={styles.mobileWeekStripContainer}>
              <button
                type="button"
                className={styles.stripNavButton}
                onClick={handlePrevWeek}
                aria-label="Previous week"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>

              <div className={styles.mobileWeekStrip} role="grid" aria-label="Week dates">
                {weekDays.map((date, idx) => {
                  const dayItems = grouped.get(date) ?? [];
                  const isToday = date === today;
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      key={date}
                      type="button"
                      className={styles.stripDay}
                      data-today={isToday || undefined}
                      data-selected={isSelected || undefined}
                      onClick={() => setSelectedDate(date)}
                      aria-current={isSelected ? "date" : undefined}
                      aria-label={`${formatDay(date, {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}${isToday ? " (Today)" : ""}${
                        dayItems.length > 0 ? `, ${dayItems.length} item${dayItems.length > 1 ? "s" : ""}` : ""
                      }`}
                    >
                      <span className={styles.stripWeekday}>{weekdayInitials[idx]}</span>
                      <span className={styles.stripDayNumber}>
                        {formatDay(date, { day: "numeric" })}
                      </span>
                      <span className={styles.stripDots} aria-hidden="true">
                        {dayItems.slice(0, 3).map((it) => (
                          <span
                            key={it.key}
                            className={styles.stripDot}
                            data-kind={it.kind}
                            style={it.entry.courseColor ? { backgroundColor: it.entry.courseColor } : undefined}
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className={styles.stripNavButton}
                onClick={handleNextWeek}
                aria-label="Next week"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.selectedDayAgenda}>
              <header className={styles.agendaHeader}>
                <div className={styles.agendaHeaderTitle}>
                  <h3>
                    {formatDay(selectedDate, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </h3>
                  {selectedDate === today ? (
                    <Badge tone="accent" size="sm">
                      Today
                    </Badge>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus size={15} />}
                  onClick={() => setNewEventDate(selectedDate)}
                  aria-label={`Add event on ${formatDay(selectedDate, {
                    month: "short",
                    day: "numeric",
                  })}`}
                >
                  Add event
                </Button>
              </header>

              <div className={styles.agendaItemList}>
                {selectedDayItems.length === 0 ? (
                  <div className={styles.emptyDayNotice}>
                    <p className={styles.emptyDayTitle}>Nothing scheduled.</p>
                    <p className={styles.emptyDaySubtitle}>Your day is open.</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() => setNewEventDate(selectedDate)}
                    >
                      Add event
                    </Button>
                  </div>
                ) : (
                  selectedDayItems.map((item) => (
                    <AgendaScheduleItem
                      key={`week-selected:${item.key}`}
                      item={item}
                      timeZone={timeZone}
                      onOpenEvent={openEvent}
                      onOpenTask={openTask}
                      onOpenWorkSession={openWorkSession}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Desktop Week Grid (>= 768px) */}
          <div className={styles.desktopWeekScroller} tabIndex={0} aria-label="Scrollable week">
            <div className={styles.weekGrid}>
              {days.map((date, index) => {
                const dayItems = grouped.get(date) ?? [];
                const isToday = date === today;
                const isSelected = date === selectedDate;
                return (
                  <section
                    key={date}
                    className={styles.weekDay}
                    data-today={isToday || undefined}
                    data-selected={isSelected || undefined}
                    onClick={() => setSelectedDate(date)}
                  >
                    <header>
                      <span>{weekdayLabels[index]}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDate(date);
                          setNewEventDate(date);
                        }}
                        aria-label={`Create event on ${formatDay(date, { dateStyle: "full" })}`}
                      >
                        {formatDay(date, { day: "numeric" })}
                      </button>
                    </header>
                    <div className={styles.weekItems}>
                      {dayItems.map((item) => (
                        <CalendarItemButton
                          key={item.key}
                          item={item}
                          timeZone={timeZone}
                          onOpenEvent={openEvent}
                          onOpenTask={openTask}
                          onOpenWorkSession={openWorkSession}
                        />
                      ))}
                      {dayItems.length === 0 ? <p className={styles.clearDay}>Clear</p> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* AGENDA VIEW */}
      {view === "agenda" ? (
        <div className={styles.agenda}>
          {days
            .filter((date) => (grouped.get(date)?.length ?? 0) > 0)
            .map((date) => {
              const dayItems = sortCalendarItemsChronologically(grouped.get(date) ?? []);
              const isToday = date === today;
              return (
                <section
                  key={date}
                  className={styles.agendaDay}
                  data-today={isToday || undefined}
                >
                  <header className={styles.agendaDayHeader}>
                    <div className={styles.agendaDayTitle}>
                      <span>{formatDay(date, { weekday: "long" })}</span>
                      <strong>{formatDay(date, { month: "short", day: "numeric" })}</strong>
                      {isToday ? (
                        <Badge tone="accent" size="sm">
                          Today
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={16} />}
                      iconOnly
                      aria-label={`Create event on ${formatDay(date, { dateStyle: "full" })}`}
                      onClick={() => {
                        setSelectedDate(date);
                        setNewEventDate(date);
                      }}
                    />
                  </header>
                  <div className={styles.agendaDayItems}>
                    {dayItems.map((item) => (
                      <AgendaScheduleItem
                        key={item.key}
                        item={item}
                        timeZone={timeZone}
                        onOpenEvent={openEvent}
                        onOpenTask={openTask}
                        onOpenWorkSession={openWorkSession}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          {items.length === 0 ? (
            <div className={styles.emptyAgenda}>
              <CalendarClock size={28} aria-hidden="true" />
              <p>No course meetings, events, scheduled tasks, or due-only deadlines in this window.</p>
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus size={15} />}
                onClick={() => setNewEventDate(anchor)}
              >
                Create event
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Modals & Editors */}
      {newEventDate !== null || editingEvent ? (
        <EventEditor
          key={editingEvent?.id ?? `new:${eventDate}`}
          event={editingEvent}
          initialDate={eventDate}
          timeZone={timeZone}
          onClose={() => {
            setEditingEvent(null);
            setNewEventDate(null);
          }}
        />
      ) : null}

      {editingTask ? (
        <TaskEditor
          key={editingTask.id}
          task={editingTask}
          timeZone={timeZone}
          onClose={() => setEditingTask(null)}
        />
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
