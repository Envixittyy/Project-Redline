"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { primaryNavigation, type PrimaryNavigationItem } from "@/lib/navigation";

import styles from "./app-shell.module.css";

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

function NavigationLink({ item, mobile = false }: { item: PrimaryNavigationItem; mobile?: boolean }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={mobile ? styles.mobileLink : styles.desktopLink}
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.iconFrame} aria-hidden="true">
        <Icon size={mobile ? 21 : 19} strokeWidth={active ? 2.25 : 1.8} />
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

export function DesktopNavigation() {
  return (
    <nav className={styles.desktopNav} aria-label="Primary navigation">
      {primaryNavigation.map((item) => (
        <NavigationLink key={item.href} item={item} />
      ))}
    </nav>
  );
}

export function MobileTabBar() {
  return (
    <nav className={styles.mobileNav} aria-label="Primary navigation">
      <div className={styles.mobileBar}>
        {primaryNavigation.map((item) => (
          <NavigationLink key={item.href} item={item} mobile />
        ))}
      </div>
    </nav>
  );
}
