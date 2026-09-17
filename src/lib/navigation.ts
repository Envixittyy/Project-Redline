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
  shortLabel?: string;
  exact?: boolean;
};

export type PrimaryNavigationItem = NavigationItem;

export const primaryNavigation: readonly NavigationItem[] = [
  { href: "/", icon: House, label: "So, Ano Na?", shortLabel: "Ano Na?", exact: true },
  { href: "/tasks", icon: ListTodo, label: "Shit to Do", shortLabel: "Shit to Do" },
  { href: "/calendar", icon: CalendarDays, label: "My Alleged Schedule", shortLabel: "Schedule" },
  { href: "/school", icon: GraduationCap, label: "Academic Suffering", shortLabel: "Suffering" },
];

export const secondaryNavigation: readonly NavigationItem[] = [
  { href: "/notes", icon: NotebookPen, label: "Notes" },
  { href: "/inbox", icon: Inbox, label: "Unsorted Bullshit", shortLabel: "Bullshit" },
];

export const moreNavigationItem: NavigationItem = {
  href: "/more",
  icon: Ellipsis,
  label: "More",
  shortLabel: "More",
};

export const mobileNavigation: readonly NavigationItem[] = [
  ...primaryNavigation,
  moreNavigationItem,
];

export const plannedAreaRoutes: readonly string[] = [
  "/anti-gastador",
  "/soon",
  "/consume",
  "/dear-dumbass",
  "/lore",
  "/people",
  "/gala",
  "/football",
  "/skills",
  "/private",
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

  if (cleanHref === "/more") {
    const isPlannedArea = plannedAreaRoutes.some(
      (route) => cleanPath === route || cleanPath.startsWith(route + "/"),
    );
    return (
      cleanPath === "/more" ||
      cleanPath.startsWith("/more/") ||
      cleanPath.startsWith("/settings/") ||
      cleanPath.startsWith("/integrations/") ||
      isPlannedArea
    );
  }

  return cleanPath === cleanHref || cleanPath.startsWith(cleanHref + "/");
}
