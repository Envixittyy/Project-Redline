"use client";

import { Clock, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useFloatingPresence } from "./use-floating-presence";
import styles from "./time-picker.module.css";

export type TimePickerProps = {
  value?: string; // HH:mm in 24-hour format
  defaultValue?: string;
  onChange?: (time: string) => void;
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
  stepMinutes?: number;
};

const PRESET_TIMES = [
  { label: "Morning", time: "09:00" },
  { label: "Noon", time: "12:00" },
  { label: "Afternoon", time: "15:00" },
  { label: "Evening", time: "18:00" },
  { label: "End of day", time: "23:59" },
];

function formatDisplayTime(time24: string): string {
  if (!time24 || !time24.includes(":")) return "";
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return time24;

  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function TimePicker({
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
  placeholder = "Select time…",
  className = "",
  compact = false,
  showClear = true,
  placement = "bottom",
  stepMinutes = 15,
}: TimePickerProps) {
  const autoId = useId();
  const baseId = customId || autoId;
  const popoverId = `${baseId}-popover`;

  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedTime = controlledValue !== undefined ? controlledValue : internalValue;

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { isMounted, isExiting } = useFloatingPresence(isOpen, 110);

  // Parse hour (0-23) and minute (0-59)
  const [parsedHour, parsedMinute] = (selectedTime || "09:00")
    .split(":")
    .map((v) => parseInt(v, 10) || 0);

  const period: "AM" | "PM" = parsedHour >= 12 ? "PM" : "AM";
  const hour12 = parsedHour % 12 === 0 ? 12 : parsedHour % 12;

  // Close when clicking outside
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

  const selectTime = useCallback(
    (time: string) => {
      if (disabled) return;
      if (min && time < min) return;
      if (max && time > max) return;

      if (controlledValue === undefined) {
        setInternalValue(time);
      }
      onChange?.(time);
      closePicker();
    },
    [disabled, min, max, controlledValue, onChange, closePicker],
  );

  const updateTimePart = useCallback(
    (newHour12: number, newMinute: number, newPeriod: "AM" | "PM") => {
      let h24 = newHour12 % 12;
      if (newPeriod === "PM") h24 += 12;
      const formatted = `${String(h24).padStart(2, "0")}:${String(newMinute).padStart(2, "0")}`;
      if (controlledValue === undefined) {
        setInternalValue(formatted);
      }
      onChange?.(formatted);
    },
    [controlledValue, onChange],
  );

  const clearTime = useCallback(
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
      setIsOpen(true);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    }
  }

  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minutes: number[] = [];
  const step = stepMinutes > 0 && stepMinutes <= 30 ? stepMinutes : 15;
  for (let m = 0; m < 60; m += step) {
    minutes.push(m);
  }

  const displayLabel = selectedTime ? formatDisplayTime(selectedTime) : placeholder;

  return (
    <div
      ref={containerRef}
      className={`${compact ? styles.compactContainer : styles.container} ${className}`}
      onKeyDown={handleKeyDown}
    >
      {name ? <input type="hidden" name={name} value={selectedTime} required={required} /> : null}

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
        aria-label={ariaLabel || (selectedTime ? `Time: ${displayLabel}` : "Choose time")}
      >
        <Clock size={compact ? 13 : 16} className={styles.icon} aria-hidden="true" />
        <span className={`${styles.label} ${!selectedTime ? styles.placeholder : ""}`}>
          {displayLabel}
        </span>
        {showClear && selectedTime && !compact && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            className={styles.clearButton}
            onClick={clearTime}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                clearTime(e as unknown as React.MouseEvent);
              }
            }}
            aria-label="Clear time"
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
          aria-label="Time picker"
          tabIndex={-1}
          className={`${styles.popover} ${
            placement === "top" ? styles.popoverTop : ""
          } ${isExiting ? styles.popoverExiting : styles.popoverEntering}`}
        >
          {/* Quick Presets */}
          <div className={styles.presetStrip}>
            {PRESET_TIMES.map((preset) => (
              <button
                key={preset.time}
                type="button"
                className={styles.presetChip}
                onClick={() => selectTime(preset.time)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Hour / Minute / AM-PM Columns */}
          <div className={styles.pickerColumns}>
            <div className={styles.column} role="listbox" aria-label="Hour">
              <div className={styles.columnHeader} aria-hidden="true">Hour</div>
              {hours.map((h) => {
                const isSelected = h === hour12;
                return (
                  <button
                    key={h}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${styles.timeOption} ${
                      isSelected ? styles.timeOptionSelected : ""
                    }`}
                    onClick={() => updateTimePart(h, parsedMinute, period)}
                  >
                    {h}
                  </button>
                );
              })}
            </div>

            <div className={styles.column} role="listbox" aria-label="Minute">
              <div className={styles.columnHeader} aria-hidden="true">Min</div>
              {minutes.map((m) => {
                const isSelected = m === parsedMinute;
                return (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${styles.timeOption} ${
                      isSelected ? styles.timeOptionSelected : ""
                    }`}
                    onClick={() => updateTimePart(hour12, m, period)}
                  >
                    :{String(m).padStart(2, "0")}
                  </button>
                );
              })}
            </div>

            <div className={styles.periodColumn}>
              <div className={styles.columnHeader} aria-hidden="true">AM/PM</div>
              <button
                type="button"
                className={`${styles.periodButton} ${
                  period === "AM" ? styles.periodButtonSelected : ""
                }`}
                onClick={() => updateTimePart(hour12, parsedMinute, "AM")}
              >
                AM
              </button>
              <button
                type="button"
                className={`${styles.periodButton} ${
                  period === "PM" ? styles.periodButtonSelected : ""
                }`}
                onClick={() => updateTimePart(hour12, parsedMinute, "PM")}
              >
                PM
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
