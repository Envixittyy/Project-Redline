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

          <div className={styles.cardsGrid}>
            <Link href="/inbox" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <Inbox size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>Capture Inbox</h3>
                  <p className={styles.cardDetail}>Raw input, proposals & reversible triage</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
            </Link>

            <Link href="/notes" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <NotebookPen size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>Notes</h3>
                  <p className={styles.cardDetail}>Quiet Markdown notes & attachments</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
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

          <div className={styles.cardsGrid}>
            <Link href="/integrations/calendars" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <CalendarSync size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>Calendar Connections</h3>
                  <p className={styles.cardDetail}>Google Calendar mirrors & capabilities</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
            </Link>

            <Link href="/integrations/blackboard" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <ShieldCheck size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>Blackboard</h3>
                  <p className={styles.cardDetail}>School email ingestion & observation</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
            </Link>

            <Link href="/integrations/notion" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <Layers size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>Notion</h3>
                  <p className={styles.cardDetail}>Selective note synchronization & export</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
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

          <div className={styles.cardsGrid}>
            <Link href="/settings/ai" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <Sparkles size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>AI Settings</h3>
                  <p className={styles.cardDetail}>Model routing, privacy gates & pairing</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
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

          <div className={styles.cardsGrid}>
            <Link href="/settings/notifications" className={styles.cardLink}>
              <div className={styles.navCard}>
                <div className={styles.cardIcon}>
                  <Bell size={20} aria-hidden="true" />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>Notification Preferences</h3>
                  <p className={styles.cardDetail}>Category toggles, quiet hours & Web Push</p>
                </div>
                <ChevronRight size={16} className={styles.cardTrailing} aria-hidden="true" />
              </div>
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

          <div className={styles.cardsGrid}>
            {secondarySections.map((sec) => {
              const Icon = sec.icon;
              return (
                <div key={sec.title} className={styles.navCard} style={{ opacity: 0.7 }}>
                  <div className={styles.cardIcon}>
                    <Icon size={20} aria-hidden="true" />
                  </div>
                  <div className={styles.cardContent}>
                    <h3 className={styles.cardTitle}>{sec.title}</h3>
                    <p className={styles.cardDetail}>{sec.detail}</p>
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
