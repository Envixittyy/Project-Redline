"use client";

import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Checkbox, DatePicker, DateTimePicker, Select } from "@/components/ui";
import { addDays, fromZonedInputValue, startOfDayIn, toZonedInputValue } from "@/lib/date/day";
import { nativeCalendarEventTypes, type CalendarEvent } from "@/types/calendar-event";

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  saveCalendarEventAction,
} from "./calendar-actions";
import { lastOccupiedDate } from "./calendar-date";
import styles from "./event-editor.module.css";

type EventEditorProps = {
  event: CalendarEvent | null;
  initialDate: string;
  timeZone: string;
  onClose: () => void;
};

export function EventEditor({ event, initialDate, timeZone, onClose }: EventEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const initialAllDay = event?.allDay ?? false;
  const eventStartDate = event ? toZonedInputValue(event.start, timeZone).slice(0, 10) : initialDate;
  const eventEndDate = event ? lastOccupiedDate(event.end, timeZone) : initialDate;
  const [fields, setFields] = useState({
    title: event?.title ?? "",
    description: event?.description ?? "",
    allDay: initialAllDay,
    startDate: eventStartDate,
    endDate: eventEndDate,
    startTime: event && !event.allDay ? toZonedInputValue(event.start, timeZone) : `${eventStartDate}T09:00`,
    endTime: event && !event.allDay ? toZonedInputValue(event.end, timeZone) : `${eventStartDate}T10:00`,
    eventType: event?.eventType ?? "event",
    course: event?.course ?? "",
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function update<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) onClose();
      else setError(result.message);
    });
  }

  function handleSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setError(null);

    const start = fields.allDay
      ? startOfDayIn(fields.startDate, timeZone).toISOString()
      : fromZonedInputValue(fields.startTime, timeZone);
    // The stored all-day end is exclusive; the form's end date is inclusive.
    const end = fields.allDay
      ? startOfDayIn(addDays(fields.endDate, 1), timeZone).toISOString()
      : fromZonedInputValue(fields.endTime, timeZone);

    const input = {
      title: fields.title,
      description: fields.description,
      start,
      end,
      allDay: fields.allDay,
      eventType: fields.eventType,
      course: fields.course,
    };

    run(() => (event ? saveCalendarEventAction(event.id, input) : createCalendarEventAction(input)));
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="event-editor-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Forward event</p>
            <h2 id="event-editor-title">{event ? "Edit event" : "New event"}</h2>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close editor" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.field}>
            <span>Title</span>
            <input
              className={styles.control}
              value={fields.title}
              maxLength={200}
              autoFocus
              required
              onChange={(changeEvent) => update("title", changeEvent.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Notes</span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={fields.description}
              onChange={(changeEvent) => update("description", changeEvent.target.value)}
            />
          </label>

          <div className={styles.checkboxField}>
            <Checkbox
              checked={fields.allDay}
              onChange={(changeEvent) => update("allDay", changeEvent.target.checked)}
              label="All-day event"
            />
          </div>

          {fields.allDay ? (
            <div className={styles.pair}>
              <div className={styles.field}>
                <span>Start date</span>
                <DatePicker
                  required
                  value={fields.startDate}
                  onChange={(val) => update("startDate", val)}
                  ariaLabel="Start date"
                />
              </div>
              <div className={styles.field}>
                <span>End date</span>
                <DatePicker
                  required
                  min={fields.startDate}
                  value={fields.endDate}
                  onChange={(val) => update("endDate", val)}
                  ariaLabel="End date"
                />
              </div>
            </div>
          ) : (
            <div className={styles.pair}>
              <div className={styles.field}>
                <span>Starts</span>
                <DateTimePicker
                  required
                  value={fields.startTime}
                  onChange={(val) => update("startTime", val)}
                  ariaLabel="Starts"
                />
              </div>
              <div className={styles.field}>
                <span>Ends</span>
                <DateTimePicker
                  required
                  min={fields.startTime}
                  value={fields.endTime}
                  onChange={(val) => update("endTime", val)}
                  ariaLabel="Ends"
                />
              </div>
            </div>
          )}

          <div className={styles.pair}>
            <div className={styles.field}>
              <span>Type</span>
              <Select
                value={fields.eventType}
                onChange={(val) => update("eventType", val)}
                ariaLabel="Event type"
                options={nativeCalendarEventTypes.map((type) => ({
                  value: type.id,
                  label: type.label,
                }))}
              />
            </div>
            <label className={styles.field}>
              <span>Course</span>
              <input
                className={styles.control}
                value={fields.course}
                autoComplete="off"
                placeholder="Optional"
                onChange={(changeEvent) => update("course", changeEvent.target.value)}
              />
            </label>
          </div>

          <p className={styles.hint}>Saved as a native event. Tasks scheduled at the same time remain separate task records.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>

        <footer className={styles.footer}>
          <div>
            {event ? confirmingDelete ? (
              <span className={styles.confirmGroup}>
                <button type="button" className={styles.dangerButton} disabled={pending} onClick={() => run(() => deleteCalendarEventAction(event.id))}>
                  Delete for good
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => setConfirmingDelete(false)}>Keep</button>
              </span>
            ) : (
              <button type="button" className={styles.secondaryButton} disabled={pending} onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            ) : null}
          </div>
          <button type="submit" className={styles.primaryButton} disabled={pending}>
            {pending ? "Saving" : event ? "Save" : "Create event"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
