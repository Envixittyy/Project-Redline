"use client";

import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import styles from "./segmented-control.module.css";

export type SegmentOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string = string> = {
  options: readonly SegmentOption<T>[] | SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  fullWidth?: boolean;
  className?: string;
};

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = false,
  className = "",
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;

    e.preventDefault();
    const enabledOptions = options.filter((o) => !o.disabled);
    const currentIndex = enabledOptions.findIndex((o) => o.value === value);
    if (currentIndex === -1) return;

    if (e.key === "ArrowRight") {
      const nextIndex = (currentIndex + 1) % enabledOptions.length;
      onChange(enabledOptions[nextIndex].value);
    } else if (e.key === "ArrowLeft") {
      const prevIndex =
        (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
      onChange(enabledOptions[prevIndex].value);
    }
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={`${styles.container} ${fullWidth ? styles.fullWidth : ""} ${className}`}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={option.disabled}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`${styles.segment} ${
              isSelected ? styles.segmentActive : ""
            }`}
          >
            {option.icon ? (
              <span aria-hidden="true" style={{ display: "inline-flex" }}>
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
