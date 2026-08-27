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
  return (
    <div className={`${styles.surface} ${styles[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}
