import Link from "next/link";
import { BookOpen, PenLine } from "lucide-react";

import styles from "./dear-dumbass-quick-post.module.css";

export function DearDumbassQuickPost() {
  return (
    <section className={styles.quickPostWrapper} aria-label="Dear Dumbass quick post">
      <Link
        href="/dear-dumbass?compose=true"
        className={styles.quickPostCard}
        aria-label="Dear Dumbass quick composer: What's pissing you off now?"
      >
        <div className={styles.iconColumn} aria-hidden="true">
          <BookOpen size={18} strokeWidth={2.2} />
        </div>
        <div className={styles.contentColumn}>
          <div className={styles.headerRow}>
            <span className={styles.label}>Dear Dumbass</span>
            <span className={styles.badge}>Private Feed</span>
          </div>
          <p className={styles.prompt}>What&apos;s pissing you off now?</p>
        </div>
        <div className={styles.actionColumn} aria-hidden="true">
          <span className={styles.writeButton}>
            <PenLine size={14} />
            <span className={styles.writeLabel}>Write</span>
          </span>
        </div>
      </Link>
    </section>
  );
}
