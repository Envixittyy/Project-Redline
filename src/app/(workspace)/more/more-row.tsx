import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import styles from "./more-page.module.css";

export type MoreRowProps = {
  href: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  badge?: string;
  ariaLabel?: string;
};

export function MoreRow({
  href,
  icon: Icon,
  title,
  detail,
  badge,
  ariaLabel,
}: MoreRowProps) {
  return (
    <Link
      href={href}
      className={styles.indexRow}
      data-has-badge={Boolean(badge) || undefined}
      aria-label={ariaLabel}
    >
      <div className={styles.rowIcon}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className={styles.rowContent}>
        <h3 className={styles.rowTitle}>{title}</h3>
        <p className={styles.rowDetail}>{detail}</p>
      </div>
      {badge ? (
        <div className={styles.rowStatus}>
          <Badge tone="neutral" size="sm" className={styles.statusBadge}>
            {badge}
          </Badge>
        </div>
      ) : null}
      <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
    </Link>
  );
}
