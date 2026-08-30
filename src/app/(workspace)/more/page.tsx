import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell,
  CalendarSync,
  FolderKanban,
  Inbox,
  LandPlot,
  Layers,
  NotebookPen,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { AppearanceControls } from "@/features/appearance/appearance-controls";
import { SignOutControl } from "@/features/auth/sign-out-control";
import { NotificationPreferences } from "@/features/notifications/notification-preferences";

import styles from "./more-page.module.css";

export const metadata: Metadata = { title: "More" };

const secondarySections = [
  { title: "Football", detail: "Club organization and EFU access", icon: Trophy },
  { title: "Projects", detail: "Simple multi-step outcomes", icon: FolderKanban },
  { title: "Areas", detail: "Ongoing parts of life", icon: LandPlot },
] as const;

export default function MorePage() {
  return (
    <>
      <PageHeader
        title="More"
        description="Appearance, notifications, and account controls live here; secondary areas will join as their phases begin."
      />
      <div className={styles.sections}>
        <section className={styles.secondaryGrid} aria-label="Future sections">
          <Link href="/settings/notifications" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <Bell size={19} />
              </span>
              <div>
                <h2>Notification Preferences</h2>
                <p>Category toggles, quiet hours & push alerts</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          <Link href="/integrations/calendars" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <CalendarSync size={19} />
              </span>
              <div>
                <h2>Calendar connections</h2>
                <p>Source-aware external providers and capabilities</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          <Link href="/inbox" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <Inbox size={19} />
              </span>
              <div>
                <h2>Capture Inbox</h2>
                <p>Raw input, proposals, and reversible commits</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          <Link href="/notes" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <NotebookPen size={19} />
              </span>
              <div>
                <h2>Notes</h2>
                <p>Private Markdown and attachments</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          <Link href="/integrations/blackboard" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2>Blackboard</h2>
                <p>Secure calendar sync and notifications</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          <Link href="/integrations/notion" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <Layers size={19} />
              </span>
              <div>
                <h2>Notion</h2>
                <p>Selective two-way knowledge sync</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          <Link href="/settings/ai" className={styles.sectionLink}>
            <Surface variant="interactive" className={styles.secondaryCard}>
              <span className={styles.secondaryIcon} aria-hidden="true">
                <Sparkles size={19} />
              </span>
              <div>
                <h2>Cloud AI</h2>
                <p>Privacy boundaries & models</p>
              </div>
              <span className={styles.open}>Open</span>
            </Surface>
          </Link>
          {secondarySections.map((section) => {
            const Icon = section.icon;
            return (
              <Surface
                key={section.title}
                variant="subtle"
                className={styles.secondaryCard}
              >
                <span className={styles.secondaryIcon} aria-hidden="true">
                  <Icon size={19} />
                </span>
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.detail}</p>
                </div>
                <span className={styles.later}>Later</span>
              </Surface>
            );
          })}
        </section>

        <Surface variant="glass" className={styles.appearance} id="appearance">
          <div className={styles.appearanceHeading}>
            <h2>Appearance</h2>
            <p>
              Choose how the workspace feels on this device. Preferences stay
              local to your browser.
            </p>
          </div>
          <AppearanceControls />
        </Surface>

        <Surface
          variant="glass"
          className={styles.notifications}
          id="notifications"
        >
          <div className={styles.notificationsHeading}>
            <h2>Notifications</h2>
            <p>
              Configure in-app categories, quiet hours, and optional device push
              delivery.
            </p>
          </div>
          <NotificationPreferences />
        </Surface>

        <Surface variant="glass" className={styles.account} id="account">
          <div className={styles.accountHeading}>
            <h2>Account</h2>
            <p>
              Your Supabase session protects this workspace and its personal
              data.
            </p>
          </div>
          <SignOutControl />
        </Surface>
      </div>
    </>
  );
}
