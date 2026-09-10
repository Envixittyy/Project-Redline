"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

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

  let renderedChild = children;
  if (isValidElement(children)) {
    const childProps = children.props as { "aria-describedby"?: string };
    const mergedDescribedBy =
      [
        childProps["aria-describedby"],
        isVisible && content ? tooltipId : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined;

    renderedChild = cloneElement(
      children as ReactElement<{ "aria-describedby"?: string }>,
      {
        "aria-describedby": mergedDescribedBy,
      },
    );
  }

  return (
    <div
      className={`${styles.wrapper} ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && isVisible) {
          e.stopPropagation();
          setIsVisible(false);
        }
      }}
    >
      {renderedChild}
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
