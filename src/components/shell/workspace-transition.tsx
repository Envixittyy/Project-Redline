"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useNavigationTransition } from "./navigation-transition-context";
import { WorkspaceRouteShell } from "./workspace-route-shell";
import styles from "./app-shell.module.css";

export function WorkspaceTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { pendingPath } = useNavigationTransition();

  if (pendingPath) {
    return (
      <div key={pendingPath} className={styles.workspaceTransition} data-navigation-pending>
        <WorkspaceRouteShell path={pendingPath} />
      </div>
    );
  }

  return (
    <div key={pathname} className={styles.workspaceTransition}>
      {children}
    </div>
  );
}
