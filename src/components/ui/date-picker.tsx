"use client";

import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { addDays, isIsoDate } from "@/lib/date/day";
import { addMonths, startOfMonth, startOfWeek } from "@/features/calendar/calendar-date";
import { useFloatingPresence } from "./use-floating-presence";
import styles from "./date-picker.module.css";

export type DatePickerProps = {
  value?: string; // YYYY-MM-DD
  defaultValue?: string;
  onChange?: (date: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  compact?: boolean;
  showClear?: boolean;
  placement?: "bottom" | "top";
};

const WEEKDAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function formatDisplayDate(iso: string): string {
  if (!isIsoDate(iso)) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function getTodayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  value: controlledValue,
  defaultValue = "",
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  name,
  id: customId,
  ariaLabel,
  placeholder = "Select date…",
  className = "",
  compact = false,
  showClear = true,
  placement = "bottom",
}: DatePickerProps) {
  const autoId = useId();
  const baseId = customId || autoId;
  const popoverId = `${baseId}-popover`;

  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedDate = controlledValue !== undefined ? controlledValue : internalValue;

  const [isOpen, setIsOpen] = useState(false);
  const [effectivePlacement, setEffectivePlacement] = useState<"bottom" | "top">(placement);
  const [effectiveAlign, setEffectiveAlign] = useState<"start" | "end">("start");
  const today = getTodayIso();
  const [viewMonth, setViewMonth] = useState(() => {
    return isIsoDate(selectedDate) ? startOfMonth(selectedDate) : startOfMonth(today);
  });
  const [focusedDay, setFocusedDay] = useState(() => {
    return isIsoDate(selectedDate) ? selectedDate : today;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { isMounted, isExiting } = useFloatingPresence(isOpen, 110);

  const updateGeometry = useCallback(() => {
    if (placement === "top") {
      setEffectivePlacement("top");
      return;
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const scrollParent = triggerRef.current.closest("dialog, [class*='body'], [class*='dialog']");
      const parentBottom = scrollParent ? scrollParent.getBoundingClientRect().bottom : window.innerHeight;
      const parentTop = scrollParent ? scrollParent.getBoundingClientRect().top : 0;
      const spaceBelow = Math.min(window.innerHeight - rect.bottom, parentBottom - rect.bottom);
      const spaceAbove = Math.min(rect.top, rect.top - parentTop);

      if (spaceBelow < 350 && spaceAbove > spaceBelow) {
        setEffectivePlacement("top");
      } else {
        setEffectivePlacement("bottom");
      }

      if (window.innerWidth - rect.left < 310 && rect.right >= 310) {
        setEffectiveAlign("end");
      } else {
        setEffectiveAlign("start");
      }
    }
  }, [placement]);

  // Ensure opened popover is visible within scrolling containers
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      popoverRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 40);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Synchronize viewMonth when selectedDate changes externally
  const [prevSelectedDate, setPrevSelectedDate] = useState(selectedDate);
  if (selectedDate !== prevSelectedDate) {
    setPrevSelectedDate(selectedDate);
    if (isIsoDate(selectedDate)) {
      setViewMonth(startOfMonth(selectedDate));
      setFocusedDay(selectedDate);
    }
  }

  // Click outside to dismiss
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const closePicker = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const selectDate = useCallback(
    (isoDate: string) => {
      if (disabled) return;
      if (min && isoDate < min) return;
      if (max && isoDate > max) return;

      if (controlledValue === undefined) {
        setInternalValue(isoDate);
      }
      onChange?.(isoDate);
      closePicker();
    },
    [disabled, min, max, controlledValue, onChange, closePicker],
  );

  const clearDate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;
      if (controlledValue === undefined) {
        setInternalValue("");
      }
      onChange?.("");
    },
    [disabled, controlledValue, onChange],
  );

  function handleTriggerClick() {
    if (disabled) return;
    if (isOpen) {
      closePicker();
    } else {
      updateGeometry();
      setIsOpen(true);
      if (isIsoDate(selectedDate)) {
        setViewMonth(startOfMonth(selectedDate));
        setFocusedDay(selectedDate);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        updateGeometry();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape": {
        e.preventDefault();
        closePicker();
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const next = addDays(focusedDay, -1);
        setFocusedDay(next);
        if (next.slice(0, 7) !== viewMonth.slice(0, 7)) {
          setViewMonth(startOfMonth(next));
        }
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const next = addDays(focusedDay, 1);
        setFocusedDay(next);
        if (next.slice(0, 7) !== viewMonth.slice(0, 7)) {
          setViewMonth(startOfMonth(next));
        }
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const next = addDays(focusedDay, -7);
        setFocusedDay(next);
        if (next.slice(0, 7) !== viewMonth.slice(0, 7)) {
          setViewMonth(startOfMonth(next));
        }
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        const next = addDays(focusedDay, 7);
        setFocusedDay(next);
        if (next.slice(0, 7) !== viewMonth.slice(0, 7)) {
          setViewMonth(startOfMonth(next));
        }
        break;
      }
      case "PageUp": {
        e.preventDefault();
        const nextMonth = addMonths(viewMonth, -1);
        setViewMonth(nextMonth);
        setFocusedDay(addMonths(focusedDay, -1));
        break;
      }
      case "PageDown": {
        e.preventDefault();
        const nextMonth = addMonths(viewMonth, 1);
        setViewMonth(nextMonth);
        setFocusedDay(addMonths(focusedDay, 1));
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        selectDate(focusedDay);
        break;
      }
    }
  }

  // Generate 42-day calendar grid (6 weeks starting Monday)
  const monthStart = startOfMonth(viewMonth);
  const gridStart = startOfWeek(monthStart);
  const calendarDays: string[] = [];
  for (let i = 0; i < 42; i++) {
    calendarDays.push(addDays(gridStart, i));
  }

  const [viewYear, viewMonthNum] = viewMonth.split("-").map(Number);
  const monthTitle = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(viewYear, viewMonthNum - 1, 1, 12, 0, 0)));

  const displayLabel = selectedDate ? formatDisplayDate(selectedDate) : placeholder;

  return (
    <div
      ref={containerRef}
      className={`${compact ? styles.compactContainer : styles.container} ${className}`}
      onKeyDown={handleKeyDown}
    >
      {name ? <input type="hidden" name={name} value={selectedDate} required={required} /> : null}

      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        className={compact ? styles.compactTrigger : styles.trigger}
        onClick={handleTriggerClick}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-label={ariaLabel || (selectedDate ? `Date: ${displayLabel}` : "Choose date")}
      >
        <CalendarIcon size={compact ? 13 : 16} className={styles.icon} aria-hidden="true" />
        <span className={`${styles.label} ${!selectedDate ? styles.placeholder : ""}`}>
          {displayLabel}
        </span>
        {showClear && selectedDate && !compact && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            className={styles.clearButton}
            onClick={clearDate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                clearDate(e as unknown as React.MouseEvent);
              }
            }}
            aria-label="Clear date"
          >
            <X size={14} aria-hidden="true" />
          </span>
        ) : null}
      </button>

      {isMounted ? (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-label="Calendar date picker"
          tabIndex={-1}
          className={`${styles.popover} ${
            effectivePlacement === "top" ? styles.popoverTop : ""
          } ${effectiveAlign === "end" ? styles.popoverEnd : ""} ${isExiting ? styles.popoverExiting : styles.popoverEntering}`}
        >
          {/* Quick preset action chips */}
          <div className={styles.presetStrip}>
            <button
              type="button"
              className={styles.presetChip}
              onClick={() => selectDate(today)}
            >
              Today
            </button>
            <button
              type="button"
              className={styles.presetChip}
              onClick={() => selectDate(addDays(today, 1))}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className={styles.presetChip}
              onClick={() => selectDate(addDays(today, 7))}
            >
              Next week
            </button>
          </div>

          {/* Month & Year Navigation Header */}
          <div className={styles.header}>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className={styles.monthLabel}>{monthTitle}</span>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              aria-label="Next month"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Weekday labels */}
          <div className={styles.weekDays} aria-hidden="true">
            {WEEKDAY_NAMES.map((name) => (
              <div key={name} className={styles.weekDay}>
                {name}
              </div>
            ))}
          </div>

          {/* 7-column Calendar Grid */}
          <div className={styles.grid} role="grid" aria-label={monthTitle}>
            {calendarDays.map((isoDay) => {
              const isSelected = isoDay === selectedDate;
              const isToday = isoDay === today;
              const isCurrentMonth = isoDay.slice(0, 7) === viewMonth.slice(0, 7);
              const isDayDisabled =
                Boolean(min && isoDay < min) || Boolean(max && isoDay > max);
              const isDayFocused = isoDay === focusedDay;

              return (
                <button
                  key={isoDay}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-disabled={isDayDisabled || undefined}
                  tabIndex={isDayFocused ? 0 : -1}
                  disabled={isDayDisabled}
                  className={`${styles.dayButton} ${
                    !isCurrentMonth ? styles.dayOutside : ""
                  } ${isToday ? styles.dayToday : ""} ${
                    isSelected ? styles.daySelected : ""
                  } ${isDayDisabled ? styles.dayDisabled : ""}`}
                  onClick={() => selectDate(isoDay)}
                  onMouseEnter={() => setFocusedDay(isoDay)}
                >
                  {Number(isoDay.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
