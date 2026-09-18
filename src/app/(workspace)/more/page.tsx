import type { Metadata } from "next";
import {
  Bell,
  BookOpen,
  CalendarSync,
  Clock,
  Compass,
  Film,
  Inbox,
  Layers,
  Lock,
  NotebookPen,
  Plane,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { AppearanceControls } from "@/features/appearance/appearance-controls";
import { SignOutControl } from "@/features/auth/sign-out-control";
import { copy } from "@/lib/copy";

import { MoreRow } from "./more-row";
import styles from "./more-page.module.css";

export const metadata: Metadata = { title: "More" };

const plannedAreas = [
  { ...copy.plannedAreas.antiGastador, icon: Wallet },
  { ...copy.plannedAreas.soon, icon: Clock },
  { ...copy.plannedAreas.media, icon: Film },
  { ...copy.plannedAreas.lore, icon: Compass },
  { ...copy.plannedAreas.people, icon: Users },
  { ...copy.plannedAreas.gala, icon: Plane },
  { ...copy.plannedAreas.football, icon: Trophy },
  { ...copy.plannedAreas.skills, icon: Target },
  { ...copy.plannedAreas.privateData, icon: Lock },
];

export default function MorePage() {
  return (
    <>
      <PageHeader
        title="More"
        description="Preferences, integrations, receipts, and deferred life areas."
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
            <MoreRow
              href="/inbox"
              icon={Inbox}
              title="Unsorted Bullshit"
              detail="Raw input stays intact. Dito muna."
            />
            <MoreRow
              href="/notes"
              icon={NotebookPen}
              title="Notes"
              detail="Quiet Markdown notes & attachments"
            />
            <MoreRow
              href="/dear-dumbass"
              icon={BookOpen}
              title="Dear Dumbass"
              detail="Private stream-of-consciousness feed (local only)"
            />
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
            <MoreRow
              href="/integrations/calendars"
              icon={CalendarSync}
              title="Calendar Connections"
              detail="Google Calendar mirrors & capabilities"
            />
            <MoreRow
              href="/integrations/blackboard"
              icon={ShieldCheck}
              title="Blackboard"
              detail="Automatic school updates from notification emails"
            />
            <MoreRow
              href="/integrations/notion"
              icon={Layers}
              title="Notion"
              detail="Selective note synchronization & export"
            />
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
            <MoreRow
              href="/settings/ai"
              icon={Sparkles}
              title="AI Settings"
              detail="Model routing, privacy gates & pairing"
            />
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
            <MoreRow
              href="/settings/notifications"
              icon={Bell}
              title="Notification Preferences"
              detail="Category toggles, quiet hours & Web Push"
            />
          </div>
        </section>

        {/* Planned Secondary Areas */}
        <section className={styles.hubSection} aria-labelledby="heading-planned">
          <div className={styles.sectionHeader}>
            <h2 id="heading-planned" className={styles.sectionTitle}>
              Planned Life Areas
            </h2>
            <p className={styles.sectionDesc}>
              Deferred areas reserved for upcoming milestones. Still cooking.
            </p>
          </div>

          <div className={styles.indexGroup}>
            {plannedAreas.map((sec) => (
              <MoreRow
                key={sec.route}
                href={sec.route}
                icon={sec.icon}
                title={sec.name}
                detail={sec.summary}
                badge={sec.status}
                ariaLabel={`${sec.name} (Planned area - ${sec.status})`}
              />
            ))}
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
