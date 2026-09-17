import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  PlannedAreaIllustration,
  type IllustrationType,
} from "./planned-area-illustrations";

import styles from "./planned-area-page.module.css";

export type PlannedAreaPageProps = {
  name: string;
  eyebrow?: string;
  headline: string;
  description: string;
  status: string;
  illustration: IllustrationType;
  capabilities?: readonly string[];
  secondaryNote?: string;
  privacyNotice?: string;
  backHref?: string;
  backLabel?: string;
};

export function PlannedAreaPage({
  name,
  eyebrow = "PLANNED AREA",
  headline,
  description,
  status,
  illustration,
  capabilities = [],
  secondaryNote,
  privacyNotice,
  backHref = "/more",
  backLabel = "Back to More",
}: PlannedAreaPageProps) {
  return (
    <article className={`${styles.container} motion-page-enter`}>
      {/* Eyebrow & Status Header */}
      <header className={styles.topBar}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <Badge tone="neutral" size="sm" className={styles.statusBadge}>
          {status}
        </Badge>
      </header>

      {/* Editorial Illustration */}
      <section className={styles.illustrationSection} aria-label={`${name} illustration`}>
        <PlannedAreaIllustration type={illustration} />
      </section>

      {/* Hero Typography */}
      <section className={styles.headerSection}>
        <h1 className={styles.title}>{name}</h1>
        <p className={styles.headline}>{headline}</p>
        <p className={styles.description}>{description}</p>
      </section>

      {/* Privacy Notice (When present) */}
      {privacyNotice ? (
        <aside className={styles.privacyNotice} aria-label="Privacy disclosure">
          <ShieldCheck size={18} className={styles.privacyNoticeIcon} aria-hidden="true" />
          <span>{privacyNotice}</span>
        </aside>
      ) : null}

      {/* Planned Capabilities Box */}
      {capabilities.length > 0 ? (
        <section className={styles.capabilitiesCard} aria-labelledby="planned-capabilities-heading">
          <h2 id="planned-capabilities-heading" className={styles.capabilitiesHeader}>
            Planned Capabilities
          </h2>
          <ul className={styles.capabilitiesList}>
            {capabilities.map((item) => (
              <li key={item} className={styles.capabilityItem}>
                <span className={styles.capabilityBullet} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Subtle Footer Note */}
      {secondaryNote ? (
        <p className={styles.secondaryNote} aria-hidden="true">
          {secondaryNote}
        </p>
      ) : null}

      {/* Back Navigation Action */}
      <footer className={styles.actionFooter}>
        <Link href={backHref} className={styles.backButton}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>{backLabel}</span>
        </Link>
      </footer>
    </article>
  );
}
