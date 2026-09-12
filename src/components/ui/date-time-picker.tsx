"use client";

import { useCallback, useState } from "react";

import { DatePicker } from "./date-picker";
import { TimePicker } from "./time-picker";
import styles from "./date-time-picker.module.css";

export type DateTimePickerProps = {
  value?: string; // YYYY-MM-DDTHH:mm
  defaultValue?: string;
  onChange?: (dateTime: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
  placement?: "bottom" | "top";
  defaultTime?: string; // default "09:00" if date is selected first
};

export function DateTimePicker({
  value: controlledValue,
  defaultValue = "",
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  name,
  id,
  ariaLabel,
  className = "",
  placement = "bottom",
  defaultTime = "09:00",
}: DateTimePickerProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;

  const [datePart = "", timePart = ""] = currentValue.split("T");

  const minDate = min ? min.split("T")[0] : undefined;
  const maxDate = max ? max.split("T")[0] : undefined;

  const handleDateChange = useCallback(
    (newDate: string) => {
      if (!newDate) {
        if (controlledValue === undefined) setInternalValue("");
        onChange?.("");
        return;
      }

      const effectiveTime = timePart || defaultTime;
      const combined = `${newDate}T${effectiveTime}`;
      if (controlledValue === undefined) setInternalValue(combined);
      onChange?.(combined);
    },
    [controlledValue, timePart, defaultTime, onChange],
  );

  const handleTimeChange = useCallback(
    (newTime: string) => {
      if (!datePart) {
        // If no date chosen yet, choose today
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const today = `${year}-${month}-${day}`;
        const combined = newTime ? `${today}T${newTime}` : "";
        if (controlledValue === undefined) setInternalValue(combined);
        onChange?.(combined);
        return;
      }

      const combined = newTime ? `${datePart}T${newTime}` : "";
      if (controlledValue === undefined) setInternalValue(combined);
      onChange?.(combined);
    },
    [controlledValue, datePart, onChange],
  );

  return (
    <div className={`${styles.container} ${className}`} id={id} aria-label={ariaLabel}>
      {name ? <input type="hidden" name={name} value={currentValue} required={required} /> : null}

      <div className={styles.dateWrapper}>
        <DatePicker
          value={datePart}
          onChange={handleDateChange}
          min={minDate}
          max={maxDate}
          disabled={disabled}
          placement={placement}
          ariaLabel={ariaLabel ? `${ariaLabel} date` : "Select date"}
          placeholder="Choose date…"
        />
      </div>

      <div className={styles.timeWrapper}>
        <TimePicker
          value={timePart}
          onChange={handleTimeChange}
          disabled={disabled}
          placement={placement}
          ariaLabel={ariaLabel ? `${ariaLabel} time` : "Select time"}
          placeholder="Choose time…"
        />
      </div>
    </div>
  );
}
