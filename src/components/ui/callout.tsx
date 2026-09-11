import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import type { ReactNode } from "react";

import styles from "./callout.module.css";

export type CalloutVariant = "info" | "success" | "warning" | "error" | "neutral";

export type CalloutProps = {
  variant?: CalloutVariant;
  tone?: CalloutVariant;
  title?: ReactNode;
  icon?: ReactNode | false;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: "status" | "alert" | "note";
};

const defaultIcons: Record<CalloutVariant, typeof Info | null> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  neutral: null,
};

export function Callout({
  variant = "info",
  tone,
  title,
  icon,
  action,
  children,
  className = "",
  id,
  role,
}: CalloutProps) {
  const activeVariant = tone ?? variant;
  const resolvedRole = role ?? (activeVariant === "error" ? "alert" : "status");

  let renderIcon: ReactNode = null;
  if (icon !== false) {
    if (icon !== undefined) {
      renderIcon = icon;
    } else {
      const DefaultIcon = defaultIcons[activeVariant];
      if (DefaultIcon) {
        renderIcon = <DefaultIcon size={18} aria-hidden="true" />;
      }
    }
  }

  return (
    <aside
      id={id}
      role={resolvedRole}
      data-variant={activeVariant}
      className={`${styles.callout} ${className}`}
    >
      {renderIcon ? <span className={styles.iconWrapper}>{renderIcon}</span> : null}
      <div className={styles.content}>
        {title ? <h4 className={styles.title}>{title}</h4> : null}
        <div className={styles.body}>{children}</div>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </aside>
  );
}
