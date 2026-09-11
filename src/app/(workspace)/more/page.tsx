import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell,
  CalendarSync,
  ChevronRight,
  FolderKanban,
  Inbox,
  LandPlot,
  Layers,
  NotebookPen,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { AppearanceControls } from "@/features/appearance/appearance-controls";
import { SignOutControl } from "@/features/auth/sign-out-control";

import styles from "./more-page.module.css";

export const metadata: Metadata = { title: "More" };

const secondarySections = [
  { title: "Football", detail: "Club organization and EFU reference", icon: Trophy },
  { title: "Projects", detail: "Simple multi-step outcomes", icon: FolderKanban },
  { title: "Areas", detail: "Ongoing parts of life", icon: LandPlot },
] as const;

export default function MorePage() {
  return (
    <>
      <PageHeader
        title="More"
        description="Personalization, integrations, intelligence, and account controls."
      />

      <div className={styles.hubContainer}>
        {/* Personalization: Appearance */}
        <section className={styles.hubSection} aria-labelledby="heading-appearance">
          <Surface variant="base" className={styles.settingsSurface} id="appearance">
            <div className={styles.surfaceHeader}>
              <h3 id="heading-appearance">Appearance</h3>
              <p>
                Choose how the workspace feels on this device. Theme and accent preferences stay
                local to your browser.
              </p>
            </div>
            <AppearanceControls />
          </Surface>
        </section>

        {/* Secondary Workflows */}
        <section className={styles.hubSection} aria-labelledby="heading-workflows">
          <div className={styles.sectionHeader}>
            <h2 id="heading-workflows" className={styles.sectionTitle}>
              Secondary Workflows
            </h2>
            <p className={styles.sectionDesc}>
              Supporting capture and knowledge spaces.
            </p>
          </div>

          <div className={styles.indexGroup}>
            <Link href="/inbox" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <Inbox size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>Capture Inbox</h3>
                <p className={styles.rowDetail}>Raw input, proposals & reversible triage</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>

            <Link href="/notes" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <NotebookPen size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>Notes</h3>
                <p className={styles.rowDetail}>Quiet Markdown notes & attachments</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Integrations & Connections */}
        <section className={styles.hubSection} aria-labelledby="heading-connections">
          <div className={styles.sectionHeader}>
            <h2 id="heading-connections" className={styles.sectionTitle}>
              Connections & Integrations
            </h2>
            <p className={styles.sectionDesc}>
              Source-aware external calendars, school feeds, and knowledge export.
            </p>
          </div>

          <div className={styles.indexGroup}>
            <Link href="/integrations/calendars" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <CalendarSync size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>Calendar Connections</h3>
                <p className={styles.rowDetail}>Google Calendar mirrors & capabilities</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>

            <Link href="/integrations/blackboard" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <ShieldCheck size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>Blackboard</h3>
                <p className={styles.rowDetail}>School email ingestion & observation</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>

            <Link href="/integrations/notion" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <Layers size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>Notion</h3>
                <p className={styles.rowDetail}>Selective note synchronization & export</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Intelligence & Privacy */}
        <section className={styles.hubSection} aria-labelledby="heading-intelligence">
          <div className={styles.sectionHeader}>
            <h2 id="heading-intelligence" className={styles.sectionTitle}>
              Intelligence & Privacy
            </h2>
            <p className={styles.sectionDesc}>
              Privacy boundaries, Local Companion daemon, and provider routing.
            </p>
          </div>

          <div className={styles.indexGroup}>
            <Link href="/settings/ai" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <Sparkles size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>AI Settings</h3>
                <p className={styles.rowDetail}>Model routing, privacy gates & pairing</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Notifications */}
        <section className={styles.hubSection} aria-labelledby="heading-notifications">
          <div className={styles.sectionHeader}>
            <h2 id="heading-notifications" className={styles.sectionTitle}>
              Notifications
            </h2>
            <p className={styles.sectionDesc}>
              Delivery rules, quiet hours, and device push alerts.
            </p>
          </div>

          <div className={styles.indexGroup}>
            <Link href="/settings/notifications" className={styles.indexRow}>
              <div className={styles.rowIcon}>
                <Bell size={18} aria-hidden="true" />
              </div>
              <div className={styles.rowContent}>
                <h3 className={styles.rowTitle}>Notification Preferences</h3>
                <p className={styles.rowDetail}>Category toggles, quiet hours & Web Push</p>
              </div>
              <ChevronRight size={14} className={styles.rowTrailing} aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Planned Secondary Areas */}
        <section className={styles.hubSection} aria-labelledby="heading-planned">
          <div className={styles.sectionHeader}>
            <h2 id="heading-planned" className={styles.sectionTitle}>
              Planned Life Areas
            </h2>
            <p className={styles.sectionDesc}>
              Deferred areas reserved for upcoming milestones.
            </p>
          </div>

          <div className={styles.indexGroup}>
            {secondarySections.map((sec) => {
              const Icon = sec.icon;
              return (
                <div key={sec.title} className={`${styles.indexRow} ${styles.disabledRow}`}>
                  <div className={styles.rowIcon}>
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div className={styles.rowContent}>
                    <h3 className={styles.rowTitle}>{sec.title}</h3>
                    <p className={styles.rowDetail}>{sec.detail}</p>
                  </div>
                  <Badge tone="neutral" size="sm">
                    Later
                  </Badge>
                </div>
              );
            })}
          </div>
        </section>

        {/* Account & Security */}
        <section className={styles.hubSection} aria-labelledby="heading-account">
          <Surface variant="base" className={styles.settingsSurface} id="account">
            <div className={styles.surfaceHeader}>
              <h3 id="heading-account">Account & Session</h3>
              <p>
                Your authenticated Supabase session protects this private workspace and all
                personal data.
              </p>
            </div>
            <SignOutControl />
          </Surface>
        </section>
      </div>
    </>
  );
}
