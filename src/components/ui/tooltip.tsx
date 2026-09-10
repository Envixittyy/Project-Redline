"use client";

import { useId, useState, type ReactNode } from "react";

import styles from "./tooltip.module.css";

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  position?: "top" | "bottom";
  className?: string;
};

export function Tooltip({
  content,
  children,
  position = "top",
  className = "",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = useId();

  return (
    <div
      className={`${styles.wrapper} ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      <div aria-describedby={isVisible ? tooltipId : undefined}>
        {children}
      </div>
      {isVisible && content ? (
        <div
          id={tooltipId}
          role="tooltip"
          className={`${styles.tooltip} ${
            position === "top" ? styles.top : styles.bottom
          }`}
        >
          {content}
        </div>
      ) : null}
    </div>
  );
}
