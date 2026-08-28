import type { Metadata } from "next";
import { FolderKanban, LandPlot, Puzzle, Trophy } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { AppearanceControls } from "@/features/appearance/appearance-controls";
import { SignOutControl } from "@/features/auth/sign-out-control";

import styles from "./more-page.module.css";

export const metadata: Metadata = { title: "More" };

const secondarySections = [
  { title: "Football", detail: "Club organization and EFU access", icon: Trophy },
  { title: "Projects", detail: "Simple multi-step outcomes", icon: FolderKanban },
  { title: "Areas", detail: "Ongoing parts of life", icon: LandPlot },
  { title: "Integrations", detail: "Connected calendars and knowledge", icon: Puzzle },
] as const;

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" description="Appearance and account controls live here; secondary areas will join as their phases begin." />
      <div className={styles.sections}>
        <section className={styles.secondaryGrid} aria-label="Future sections">
          {secondarySections.map((section) => {
            const Icon = section.icon;
            return (
              <Surface key={section.title} variant="subtle" className={styles.secondaryCard}>
                <span className={styles.secondaryIcon} aria-hidden="true"><Icon size={19} /></span>
                <div><h2>{section.title}</h2><p>{section.detail}</p></div>
                <span className={styles.later}>Later</span>
              </Surface>
            );
          })}
        </section>

        <Surface variant="glass" className={styles.appearance} id="appearance">
          <div className={styles.appearanceHeading}>
            <h2>Appearance</h2>
            <p>Choose how the workspace feels on this device. Preferences stay local to your browser.</p>
          </div>
          <AppearanceControls />
        </Surface>

        <Surface variant="glass" className={styles.account} id="account">
          <div className={styles.accountHeading}>
            <h2>Account</h2>
            <p>
              Your Supabase session protects this workspace and its personal data.
            </p>
          </div>
          <SignOutControl />
        </Surface>
      </div>
    </>
  );
}
