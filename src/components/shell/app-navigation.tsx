"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

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
  active,
  mobile = false,
}: {
  item: NavigationItem;
  active: boolean;
  mobile?: boolean;
}) {
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
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const activeLink = navRef.current?.querySelector<HTMLElement>("[data-active='true']");
    if (!activeLink) return;

    setIndicator({ top: activeLink.offsetTop, height: activeLink.offsetHeight });
    const timer = setTimeout(() => setAnimated(true), 50);
    return () => clearTimeout(timer);
  }, [pathname]);

  const indicatorStyle = {
    "--active-indicator-y": `${indicator.top}px`,
    "--active-indicator-height": `${indicator.height}px`,
  } as CSSProperties;

  return (
    <nav
      ref={navRef}
      className={styles.desktopNav}
      aria-label="Primary navigation"
      style={indicatorStyle}
      data-indicator-ready={indicator.height > 0 || undefined}
      data-indicator-animated={animated || undefined}
    >
      <span className={styles.desktopActiveIndicator} aria-hidden="true" />
      <div className={styles.navGroup}>
        {primaryNavigation.map((item) => (
          <NavigationLink
            key={item.href}
            item={item}
            active={isActiveRoute(pathname, item.href, item.exact)}
          />
        ))}
      </div>

      <div className={styles.navDivider} role="separator" />

      <div className={styles.navGroup}>
        <span className={styles.navSectionTitle}>Workspace</span>
        {secondaryNavigation.map((item) => (
          <NavigationLink
            key={item.href}
            item={item}
            active={isActiveRoute(pathname, item.href, item.exact)}
          />
        ))}
      </div>

      <div className={styles.navDivider} role="separator" />

      <div className={styles.navGroup}>
        <NavigationLink
          item={moreNavigationItem}
          active={isActiveRoute(pathname, moreNavigationItem.href, moreNavigationItem.exact)}
        />
      </div>
    </nav>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const activeIndex = Math.max(
    0,
    mobileNavigation.findIndex((item) =>
      isActiveRoute(pathname, item.href, item.exact),
    ),
  );
  const markerStyle = { "--active-index": activeIndex } as CSSProperties;

  return (
    <nav className={styles.mobileNav} aria-label="Primary navigation">
      <div className={styles.mobileBar} style={markerStyle}>
        <span className={styles.mobileActiveMarker} aria-hidden="true" />
        {mobileNavigation.map((item) => (
          <NavigationLink
            key={item.href}
            item={item}
            active={isActiveRoute(pathname, item.href, item.exact)}
            mobile
          />
        ))}
      </div>
    </nav>
  );
}
