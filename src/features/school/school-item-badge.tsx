import {
  BookOpen,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  Megaphone,
  Sparkles,
} from "lucide-react";
import type { SchoolItemType } from "@/types/school-item";
import styles from "./school-item-badge.module.css";

const badgeConfig: Record<
  SchoolItemType,
  { label: string; icon: typeof ClipboardList; className: string }
> = {
  assignment: { label: "Assignment", icon: ClipboardList, className: styles.assignment },
  quiz: { label: "Quiz", icon: FileQuestion, className: styles.quiz },
  exam: { label: "Exam", icon: GraduationCap, className: styles.exam },
  material: { label: "Material", icon: BookOpen, className: styles.material },
  announcement: { label: "Announcement", icon: Megaphone, className: styles.announcement },
  course_opened: { label: "Course Opened", icon: Sparkles, className: styles.course_opened },
  unknown: { label: "Item", icon: ClipboardList, className: styles.unknown },
};

type SchoolItemBadgeProps = {
  itemType: SchoolItemType;
  size?: number;
};

export function SchoolItemBadge({ itemType, size = 12 }: SchoolItemBadgeProps) {
  const config = badgeConfig[itemType] ?? badgeConfig.unknown;
  const Icon = config.icon;

  return (
    <span className={`${styles.badge} ${config.className}`}>
      <Icon size={size} aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
