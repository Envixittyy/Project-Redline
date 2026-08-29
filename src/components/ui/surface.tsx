import type { HTMLAttributes, ReactNode } from "react";

import styles from "./surface.module.css";

export type SurfaceVariant = "base" | "glass" | "elevated" | "subtle" | "interactive";

type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  variant?: SurfaceVariant;
};

export function Surface({
  children,
  className = "",
  variant = "base",
  ...props
}: SurfaceProps) {
  const motionClass = variant === "interactive" ? "motion-interactive" : "";

  return (
    <div
      className={`${styles.surface} ${styles[variant]} ${motionClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
