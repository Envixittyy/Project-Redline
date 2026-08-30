export const notificationTypes = [
  "blackboard_assignment",
  "blackboard_deadline_changed",
  "blackboard_proposal_divergence",
  "task_due_soon",
  "task_overdue",
  "due_reminder",
  "calendar_event_soon",
  "school_class_soon",
  "sync_failure",
  "daily_digest",
] as const;

export type NotificationType = (typeof notificationTypes)[number];

export const notificationDomains = [
  "tasks",
  "calendar",
  "school",
  "blackboard",
  "system",
] as const;

export type NotificationDomain = (typeof notificationDomains)[number];

export type NotificationEvent = {
  id: string;
  userId: string;
  eventType: NotificationType | string;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string;
  courseId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreference = {
  id: string;
  userId: string;
  courseId: string | null;
  notificationType: string;
  enabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  timeZone: string;
  dailyDigest: boolean;
};

export type NotificationPreferencesState = {
  taskReminders: boolean;
  calendarReminders: boolean;
  schoolClassReminders: boolean;
  blackboardNewItems: boolean;
  blackboardDeadlineChanges: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timeZone: string;
  dailyDigest: boolean;
  courseOverrides?: Record<string, { enabled: boolean }>;
};

export type PlannedNotification = {
  eventType: NotificationType | string;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string;
  courseId?: string | null;
};

export type CreateNotificationEventInput = {
  userId: string;
  eventType: NotificationType | string;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string;
  courseId?: string | null;
};

