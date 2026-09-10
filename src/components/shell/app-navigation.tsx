"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  primaryNavigation,
  secondaryNavigation,
  moreNavigationItem,
  mobileNavigation,
  isActiveRoute,
  type NavigationItem,
} from "@/lib/navigation";

import styles from "./app-shell.module.css";

function NavigationLink({
  item,
  mobile = false,
}: {
  item: NavigationItem;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const active = isActiveRoute(pathname, item.href, item.exact);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={mobile ? styles.mobileLink : styles.desktopLink}
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.iconFrame} aria-hidden="true">
        <Icon size={mobile ? 20 : 18} strokeWidth={active ? 2.25 : 1.8} />
      </span>
      <span className={styles.linkLabel}>{item.label}</span>
    </Link>
  );
}

export function DesktopNavigation() {
  return (
    <nav className={styles.desktopNav} aria-label="Primary navigation">
      <div className={styles.navGroup}>
        {primaryNavigation.map((item) => (
          <NavigationLink key={item.href} item={item} />
        ))}
      </div>

      <div className={styles.navDivider} role="separator" />

      <div className={styles.navGroup}>
        <span className={styles.navSectionTitle}>Workspace</span>
        {secondaryNavigation.map((item) => (
          <NavigationLink key={item.href} item={item} />
        ))}
      </div>

      <div className={styles.navDivider} role="separator" />

      <div className={styles.navGroup}>
        <NavigationLink item={moreNavigationItem} />
      </div>
    </nav>
  );
}

export function MobileTabBar() {
  return (
    <nav className={styles.mobileNav} aria-label="Primary navigation">
      <div className={styles.mobileBar}>
        {mobileNavigation.map((item) => (
          <NavigationLink key={item.href} item={item} mobile />
        ))}
      </div>
    </nav>
  );
}
