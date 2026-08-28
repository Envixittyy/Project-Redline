import Link from "next/link";
import { Settings2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { DesktopNavigation, MobileTabBar } from "./app-navigation";
import { PwaClient } from "@/features/offline/pwa-client";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <div className={styles.ambient} aria-hidden="true" />

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

        <div className={styles.sidebarFooter}>
          <Link className={styles.appearanceLink} href="/more#appearance">
            <Settings2 size={18} aria-hidden="true" />
            <span>Appearance</span>
          </Link>
          <p>Quietly shaping the day ahead.</p>
        </div>
      </aside>

      <div className={styles.contentFrame}>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>

      <MobileTabBar />
      <PwaClient />
    </div>
  );
}
