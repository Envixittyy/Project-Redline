"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigationTransition } from "./navigation-transition-context";

import {
  desktopNavigationGroups,
  primaryNavigation,
  moreNavigationItem,
  mobileNavigation,
  isActiveRoute,
  type NavigationItem,
} from "@/lib/navigation";

import styles from "./app-shell.module.css";

function NavigationLink({
  item,
  active,
  current,
  mobile = false,
}: {
  item: NavigationItem;
  active: boolean;
  current: boolean;
  mobile?: boolean;
}) {
  const Icon = item.icon;
  const { beginNavigation } = useNavigationTransition();
  const warmRoute =
    primaryNavigation.some(({ href }) => href === item.href) ||
    item.href === moreNavigationItem.href;

  return (
    <Link
      href={item.href}
      prefetch={warmRoute ? null : false}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          beginNavigation(item.href);
        }
      }}
      className={mobile ? styles.mobileLink : styles.desktopLink}
      data-active={active || undefined}
      aria-current={current ? "page" : undefined}
    >
      <span className={styles.iconFrame} aria-hidden="true">
        <Icon size={mobile ? 20 : 18} strokeWidth={active ? 2.25 : 1.8} />
      </span>
      <span className={styles.linkLabel}>
        {mobile && item.shortLabel ? item.shortLabel : item.label}
      </span>
      {!mobile && item.status === "planned" && (
        <span className={styles.wipBadge} title="Work in progress (planned)">
          <span className={styles.wipText}>WIP</span>
          <span className="sr-only"> (Planned / Work in progress)</span>
        </span>
      )}
    </Link>
  );
}

export function DesktopNavigation() {
  const pathname = usePathname();
  const { pendingPath } = useNavigationTransition();
  const visualPathname = pendingPath ?? pathname;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const activeLink = container.querySelector<HTMLElement>(
      "[data-active='true']",
    );
    if (!activeLink) {
      setIndicator({ top: 0, height: 0 });
      return;
    }

    // Ensure active element is scrolled into view within the scroll container
    const activeRect = activeLink.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (
      activeRect.top < containerRect.top ||
      activeRect.bottom > containerRect.bottom
    ) {
      activeLink.scrollIntoView({ block: "nearest" });
    }

    // Re-measure after scroll adjustment
    const updatedActiveRect = activeLink.getBoundingClientRect();
    const updatedContainerRect = container.getBoundingClientRect();
    const top =
      updatedActiveRect.top - updatedContainerRect.top + container.scrollTop;

    setIndicator({
      top,
      height: updatedActiveRect.height,
    });
    const timer = setTimeout(() => setAnimated(true), 50);
    return () => clearTimeout(timer);
  }, [visualPathname]);

  const indicatorStyle = {
    "--active-indicator-y": `${indicator.top}px`,
    "--active-indicator-height": `${indicator.height}px`,
  } as CSSProperties;

  return (
    <nav className={styles.desktopNav} aria-label="Primary navigation">
      <div
        ref={scrollRef}
        className={styles.desktopNavScroll}
        style={indicatorStyle}
        data-indicator-ready={indicator.height > 0 || undefined}
        data-indicator-animated={animated || undefined}
      >
        <span className={styles.desktopActiveIndicator} aria-hidden="true" />
        {desktopNavigationGroups.map((group, groupIdx) => (
          <div key={group.label} className={styles.navGroupWrapper}>
            {groupIdx > 0 && (
              <div className={styles.navDivider} role="separator" />
            )}
            <div className={styles.navGroup}>
              <span className={styles.navSectionTitle}>{group.label}</span>
              {group.items.map((item) => (
                <NavigationLink
                  key={item.href}
                  item={item}
                  active={isActiveRoute(visualPathname, item.href, item.exact, {
                    isDesktop: true,
                  })}
                  current={isActiveRoute(pathname, item.href, item.exact, {
                    isDesktop: true,
                  })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.desktopNavFooter}>
        <div className={styles.navDivider} role="separator" />
        <div className={styles.navGroup}>
          <NavigationLink
            item={moreNavigationItem}
            active={isActiveRoute(
              visualPathname,
              moreNavigationItem.href,
              moreNavigationItem.exact,
              { isDesktop: true },
            )}
            current={isActiveRoute(
              pathname,
              moreNavigationItem.href,
              moreNavigationItem.exact,
              { isDesktop: true },
            )}
          />
        </div>
      </div>
    </nav>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { pendingPath } = useNavigationTransition();
  const visualPathname = pendingPath ?? pathname;
  const activeIndex = Math.max(
    0,
    mobileNavigation.findIndex((item) =>
      isActiveRoute(visualPathname, item.href, item.exact),
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
            active={isActiveRoute(visualPathname, item.href, item.exact)}
            current={isActiveRoute(pathname, item.href, item.exact)}
            mobile
          />
        ))}
      </div>
    </nav>
  );
}
