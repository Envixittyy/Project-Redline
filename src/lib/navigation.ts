import {
  CalendarDays,
  Ellipsis,
  GraduationCap,
  House,
  ListTodo,
  type LucideIcon,
} from "lucide-react";

export type PrimaryNavigationItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

export const primaryNavigation: PrimaryNavigationItem[] = [
  { href: "/", icon: House, label: "Home" },
  { href: "/tasks", icon: ListTodo, label: "Tasks" },
  { href: "/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/school", icon: GraduationCap, label: "School" },
  { href: "/more", icon: Ellipsis, label: "More" },
];
