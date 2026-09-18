import {
  BookOpen,
  CalendarDays,
  Clock,
  Compass,
  Ellipsis,
  Film,
  Focus,
  GraduationCap,
  House,
  Inbox,
  ListTodo,
  Lock,
  NotebookPen,
  Plane,
  Target,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavigationItemStatus = "planned";

export type NavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  shortLabel?: string;
  exact?: boolean;
  status?: NavigationItemStatus;
};

export type PrimaryNavigationItem = NavigationItem;

export type NavigationGroup = {
  label: string;
  items: readonly NavigationItem[];
};

export const desktopNavigationGroups: readonly NavigationGroup[] = [
  {
    label: "Core",
    items: [
      { href: "/", icon: House, label: "So, Ano Na?", shortLabel: "Ano Na?", exact: true },
      { href: "/tasks", icon: ListTodo, label: "Shit to Do", shortLabel: "Shit to Do" },
      { href: "/calendar", icon: CalendarDays, label: "My Alleged Schedule", shortLabel: "Schedule" },
      { href: "/school", icon: GraduationCap, label: "Academic Suffering", shortLabel: "Suffering" },
      { href: "/focus", icon: Focus, label: "Lock In mofo", shortLabel: "Lock In" },
    ],
  },
  {
    label: "My Stuff",
    items: [
      { href: "/notes", icon: NotebookPen, label: "Notes", shortLabel: "Notes" },
      { href: "/inbox", icon: Inbox, label: "Unsorted Bullshit", shortLabel: "Bullshit" },
      { href: "/dear-dumbass", icon: BookOpen, label: "Dear Dumbass", shortLabel: "Dear Dumbass" },
      { href: "/lore", icon: Compass, label: "Lore", status: "planned" },
      { href: "/people", icon: Users, label: "These Mfs", status: "planned" },
    ],
  },
  {
    label: "Life, Apparently",
    items: [
      { href: "/gala", icon: Plane, label: "Gala", status: "planned" },
      { href: "/anti-gastador", icon: Wallet, label: "Anti-Gastador", status: "planned" },
      { href: "/soon", icon: Clock, label: "Soon™", status: "planned" },
      { href: "/consume", icon: Film, label: "Things to Consume Before I Die", status: "planned" },
    ],
  },
  {
    label: "Other Shit",
    items: [
      { href: "/football", icon: Trophy, label: "Football", status: "planned" },
      { href: "/skills", icon: Target, label: "Skills", status: "planned" },
      { href: "/private", icon: Lock, label: "None of Your Business", status: "planned" },
    ],
  },
];

export const primaryNavigation: readonly NavigationItem[] = [
  { href: "/", icon: House, label: "So, Ano Na?", shortLabel: "Ano Na?", exact: true },
  { href: "/tasks", icon: ListTodo, label: "Shit to Do", shortLabel: "Shit to Do" },
  { href: "/calendar", icon: CalendarDays, label: "My Alleged Schedule", shortLabel: "Schedule" },
  { href: "/school", icon: GraduationCap, label: "Academic Suffering", shortLabel: "Suffering" },
];

export const secondaryNavigation: readonly NavigationItem[] = [
  { href: "/notes", icon: NotebookPen, label: "Notes" },
  { href: "/inbox", icon: Inbox, label: "Unsorted Bullshit", shortLabel: "Bullshit" },
  { href: "/dear-dumbass", icon: BookOpen, label: "Dear Dumbass", shortLabel: "Dear Dumbass" },
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
  "/lore",
  "/people",
  "/gala",
  "/football",
  "/skills",
  "/private",
];

export type ActiveRouteOptions = {
  exact?: boolean;
  isDesktop?: boolean;
};

/**
 * Determines whether the current path matches a destination route.
 * Handles exact root path matches, subroute paths, and query string / anchor stripping.
 * In desktop context, planned area routes have their own visible navigation links and do not activate /more.
 */
export function isActiveRoute(
  pathname: string,
  href: string,
  exactOrOptions?: boolean | ActiveRouteOptions,
  options?: ActiveRouteOptions,
): boolean {
  if (!pathname || !href) return false;

  const resolvedOptions: ActiveRouteOptions =
    typeof exactOrOptions === "object" && exactOrOptions !== null
      ? exactOrOptions
      : { exact: Boolean(exactOrOptions), ...options };

  const exact = resolvedOptions.exact ?? false;
  const isDesktop = resolvedOptions.isDesktop ?? false;

  const cleanPath = pathname.split("?")[0].split("#")[0] || "/";
  const cleanHref = href.split("?")[0].split("#")[0] || "/";

  if (exact || cleanHref === "/") {
    return cleanPath === cleanHref;
  }

  if (cleanHref === "/more") {
    const isPlannedArea = plannedAreaRoutes.some(
      (route) => cleanPath === route || cleanPath.startsWith(route + "/"),
    );
    const isSecondaryWorkflow =
      cleanPath === "/dear-dumbass" || cleanPath.startsWith("/dear-dumbass/");

    if (isDesktop && (isPlannedArea || isSecondaryWorkflow)) {
      return false;
    }

    return (
      cleanPath === "/more" ||
      cleanPath.startsWith("/more/") ||
      cleanPath.startsWith("/settings/") ||
      cleanPath.startsWith("/integrations/") ||
      isPlannedArea ||
      isSecondaryWorkflow
    );
  }

  return cleanPath === cleanHref || cleanPath.startsWith(cleanHref + "/");
}
