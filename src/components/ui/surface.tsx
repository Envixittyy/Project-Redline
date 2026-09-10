import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import styles from "./surface.module.css";

export type SurfaceVariant =
  | "base"
  | "glass"
  | "elevated"
  | "subtle"
  | "interactive";

export type SurfacePadding = "none" | "sm" | "md" | "lg";

export type SurfaceProps<T extends ElementType = "div"> = {
  as?: T;
  children: ReactNode;
  variant?: SurfaceVariant;
  padding?: SurfacePadding;
  className?: string;
} & ComponentPropsWithoutRef<T>;

/**
 * Surface hierarchy:
 * - `base`: Ordinary content cards & list items (solid neutral background, soft card shadow)
 * - `subtle`: Secondary groupings & recessed containers (faint background, hairline border)
 * - `interactive`: Clickable items (tactile hover lift translateY(-1px), active scale(0.985))
 * - `elevated`: Raised panels, prominent cards (higher elevation shadow, illuminated top border)
 * - `glass`: Floating navigation, overlays, modals (liquid-glass backdrop blur, translucent fill)
 */
export function Surface<T extends ElementType = "div">({
  as,
  children,
  className = "",
  variant = "base",
  padding = "none",
  ...props
}: SurfaceProps<T>) {
  const Component = as || "div";
  const motionClass = variant === "interactive" ? "motion-interactive" : "";

  const paddingClass =
    padding === "sm"
      ? styles.padSm
      : padding === "md"
      ? styles.padMd
      : padding === "lg"
      ? styles.padLg
      : styles.padNone;

  return (
    <Component
      className={`${styles.surface} ${styles[variant]} ${paddingClass} ${motionClass} ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
