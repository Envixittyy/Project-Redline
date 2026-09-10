import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import styles from "./badge.module.css";

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "accent"
  | "course";

export type BadgeVariant = "subtle" | "outline" | "solid";
export type BadgeSize = "sm" | "md";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children?: ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  courseColor?: string;
  icon?: ReactNode;
};

export function Badge({
  children,
  className = "",
  tone = "neutral",
  variant = "subtle",
  size = "md",
  dot = false,
  courseColor,
  icon,
  style,
  ...props
}: BadgeProps) {
  const customStyle: CSSProperties = {
    ...style,
    ...(courseColor
      ? ({ "--course-color": courseColor } as CSSProperties)
      : {}),
  };

  return (
    <span
      className={`${styles.badge} ${styles[variant]} ${styles[tone]} ${styles[size]} ${className}`}
      style={customStyle}
      {...props}
    >
      {dot ? (
        <span
          className={`${styles.dot} ${
            tone === "course" ? styles.courseDot : ""
          }`}
          aria-hidden="true"
        />
      ) : null}
      {icon ? (
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
