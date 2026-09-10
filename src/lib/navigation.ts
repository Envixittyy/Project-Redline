import {
  CalendarDays,
  Ellipsis,
  GraduationCap,
  House,
  Inbox,
  ListTodo,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
};

export type PrimaryNavigationItem = NavigationItem;

export const primaryNavigation: readonly NavigationItem[] = [
  { href: "/", icon: House, label: "Home", exact: true },
  { href: "/tasks", icon: ListTodo, label: "Tasks" },
  { href: "/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/school", icon: GraduationCap, label: "School" },
];

export const secondaryNavigation: readonly NavigationItem[] = [
  { href: "/notes", icon: NotebookPen, label: "Notes" },
  { href: "/inbox", icon: Inbox, label: "Capture Inbox" },
];

export const moreNavigationItem: NavigationItem = {
  href: "/more",
  icon: Ellipsis,
  label: "More",
};

export const mobileNavigation: readonly NavigationItem[] = [
  ...primaryNavigation,
  moreNavigationItem,
];

/**
 * Determines whether the current path matches a destination route.
 * Handles exact root path matches, subroute paths, and query string / anchor stripping.
 */
export function isActiveRoute(pathname: string, href: string, exact = false): boolean {
  if (!pathname || !href) return false;
  const cleanPath = pathname.split("?")[0].split("#")[0] || "/";
  const cleanHref = href.split("?")[0].split("#")[0] || "/";

  if (exact || cleanHref === "/") {
    return cleanPath === cleanHref;
  }

  return cleanPath === cleanHref || cleanPath.startsWith(cleanHref + "/");
}
