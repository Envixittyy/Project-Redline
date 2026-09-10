import type { ReactNode } from "react";

import styles from "./empty-state.module.css";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      {icon ? (
        <div className={styles.iconWrapper} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className={styles.title}>{title}</h3>
      {description ? (
        <p className={styles.description}>{description}</p>
      ) : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
