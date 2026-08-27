import type { LucideIcon } from "lucide-react";

import { Surface } from "./surface";
import styles from "./section-placeholder.module.css";

type SectionPlaceholderProps = {
  description: string;
  icon: LucideIcon;
  phase: string;
  title: string;
};

export function SectionPlaceholder({ description, icon: Icon, phase, title }: SectionPlaceholderProps) {
  return (
    <Surface variant="glass" className={styles.placeholder}>
      <div className={styles.icon} aria-hidden="true"><Icon size={24} /></div>
      <p className={styles.phase}>{phase}</p>
      <h2>{title}</h2>
      <p className={styles.description}>{description}</p>
      <div className={styles.lines} aria-hidden="true"><span /><span /><span /></div>
    </Surface>
  );
}
