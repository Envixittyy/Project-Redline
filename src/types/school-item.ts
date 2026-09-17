import type { TaskStatus } from "./task";

export const schoolItemTypes = ["assignment", "quiz", "exam", "material", "announcement", "course_opened", "unknown"] as const;
export type SchoolItemType = (typeof schoolItemTypes)[number];
export type SchoolNotificationType = SchoolItemType | "deadline_changed" | "reminder" | "submission_received" | "grade_updated";
export type SchoolIngestionStatus = "processed" | "duplicate" | "ignored" | "unknown_type" | "malformed" | "unresolved_course" | "unresolved_item" | "unresolved_task" | "stale";

/** Provider-independent, minimized evidence. Bodies and mailbox headers are not persisted. */
export type ParsedSchoolEvent = {
  source: "blackboard";
  messageKey: string;
  provider: string;
  sourceMessageId: string;
  receivedAt: string;
  sourceAt: string | null;
  parserVersion: "blackboard-email-v1";
  status: "parsed" | "ignored" | "unknown_type" | "malformed";
  notificationType: SchoolNotificationType;
  itemType: SchoolItemType;
  courseHint: string | null;
  baseCourseCode: string | null;
  courseKey: string | null;
  title: string | null;
  titleKey: string | null;
  sourceKey: string | null;
  sourceUrl: string | null;
  dueDate: string | null;
  dueAt: string | null;
  duePrecision: "none" | "date" | "instant" | "unresolved";
  weight: number | null;
  evidence: string | null;
  reason: string | null;
};

export type SchoolItem = {
  id: string;
  courseId: string;
  itemType: SchoolItemType;
  title: string;
  dueDate: string | null;
  dueAt: string | null;
  sourceUrl: string | null;
  weight: number | null;
  taskId: string | null;
  taskStatus?: TaskStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type SchoolEmailEvent = {
  id: string;
  status: SchoolIngestionStatus;
  itemId: string | null;
  courseId: string | null;
  receivedAt: string;
  parsedEvent: ParsedSchoolEvent;
};

export type SchoolIngestionResult = {
  status: SchoolIngestionStatus;
  eventId: string;
  itemId: string | null;
  taskId: string | null;
};
