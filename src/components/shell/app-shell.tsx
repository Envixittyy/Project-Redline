import Link from "next/link";
import { Settings2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { DesktopNavigation, MobileTabBar } from "./app-navigation";
import { CommandPalette, CommandPaletteTrigger } from "./command-palette";
import { AmbientEnvironment } from "./ambient-environment";
import { AmbientProvider } from "./ambient-context";
import { CaptureLauncher, CaptureTrigger } from "@/features/capture/capture-launcher";
import { NotificationCenter } from "@/features/notifications/notification-center";
import { NotificationTrigger } from "@/features/notifications/notification-trigger";
import { PwaClient } from "@/features/offline/pwa-client";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AmbientProvider>
      <div className={styles.shell}>
        <a className={styles.skipLink} href="#main-content">
          Skip to content
        </a>
        <AmbientEnvironment />

        <aside className={styles.sidebar}>
          <div className={styles.identity}>
            <span className={styles.brandMark} aria-hidden="true">
              <Sparkles size={18} strokeWidth={2} />
            </span>
            <div>
              <p className={styles.productName}>Forward</p>
              <p className={styles.productNote}>Be curious, not judgmental.</p>
            </div>
          </div>

          <DesktopNavigation />
          <NotificationTrigger />
          <CaptureTrigger />
          <CommandPaletteTrigger />

          <div className={styles.sidebarFooter}>
            <Link className={styles.appearanceLink} href="/more#appearance">
              <Settings2 size={18} aria-hidden="true" />
              <span>Appearance</span>
            </Link>
            <p>Quietly shaping the day ahead.</p>
          </div>
        </aside>

        <div className={styles.contentFrame}>
          <div className={styles.mobileTopbar}>
            <Link className={styles.mobileIdentity} href="/">
              Forward
            </Link>
            <div className={styles.mobileActions}>
              <NotificationTrigger compact />
              <CaptureTrigger compact />
              <CommandPaletteTrigger compact />
            </div>
          </div>
          <main id="main-content" className={styles.main} tabIndex={-1}>
            {children}
          </main>
        </div>

        <MobileTabBar />
        <PwaClient />
        <CaptureLauncher />
        <CommandPalette />
        <NotificationCenter />
      </div>
    </AmbientProvider>
  );
}
