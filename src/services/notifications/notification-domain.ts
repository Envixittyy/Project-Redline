import type {
  NotificationDomain,
  NotificationEvent,
  NotificationType,
  PlannedNotification,
} from "@/types/notification";
import type { Task } from "@/types/task";
import type { CalendarEvent } from "@/types/calendar-event";
import type { Course, PersistedCourseMeeting } from "@/types/course";
import type { CourseMeeting } from "@/types/course-meeting";
import { todayIn } from "@/lib/date/day";

export type {
  NotificationDomain,
  NotificationEvent,
  NotificationType,
  PlannedNotification,
};

export type BlackboardNotificationKind =
  | "new_proposal"
  | "proposal_changed"
  | "deadline_changed"
  | "divergence";

export function notificationDedupeKey(
  type: NotificationType | string,
  sourceId: string,
  revision: string,
): string {
  return `${type}:${sourceId}:${revision}`;
}

export function safeDeepLink(value: string): string {
  return /^\/(?!\/)[A-Za-z0-9/_?=&%.-]*$/.test(value) ? value : "/";
}

export function getNotificationDomain(
  eventType: NotificationType | string,
): NotificationDomain {
  if (eventType.startsWith("blackboard_")) return "blackboard";
  if (
    eventType.startsWith("task_") ||
    eventType === "due_reminder"
  ) {
    return "tasks";
  }
  if (eventType.startsWith("calendar_")) return "calendar";
  if (eventType.startsWith("school_")) return "school";
  return "system";
}

export function getNotificationDomainLabel(
  domain: NotificationDomain,
): string {
  switch (domain) {
    case "blackboard":
      return "Blackboard";
    case "tasks":
      return "Task";
    case "calendar":
      return "Calendar";
    case "school":
      return "School";
    case "system":
    default:
      return "System";
  }
}

export function isQuietHours(
  now: Date,
  timeZone: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return start < end
    ? parts >= start && parts < end
    : parts >= start || parts < end;
}

export function pushAvailability(input: {
  serviceWorker: boolean;
  pushManager: boolean;
  standalone: boolean;
  isIOS: boolean;
  vapidKey: boolean;
}) {
  if (!input.serviceWorker || !input.pushManager) {
    return { available: false, reason: "unsupported" as const };
  }
  if (input.isIOS && !input.standalone) {
    return { available: false, reason: "install_required" as const };
  }
  if (!input.vapidKey) {
    return { available: false, reason: "server_unconfigured" as const };
  }
  return { available: true, reason: null };
}

export function safeNotificationPayload(input: {
  title: string;
  body: string;
  deepLink: string;
  dedupeKey: string;
}) {
  return {
    title: input.title.slice(0, 100),
    body: input.body.replace(/https?:\/\/\S+/gi, "[link removed]").slice(0, 240),
    url: safeDeepLink(input.deepLink),
    dedupeKey: input.dedupeKey,
  };
}

export function formatBlackboardNotificationTitle(
  kind: BlackboardNotificationKind = "new_proposal",
): string {
  switch (kind) {
    case "deadline_changed":
      return "Blackboard deadline changed";
    case "proposal_changed":
    case "divergence":
      return "Blackboard item updated";
    case "new_proposal":
    default:
      return "New Blackboard item";
  }
}

export function formatBlackboardNotificationBody(
  item: { title?: string | null; courseCode?: string | null },
  kind: BlackboardNotificationKind = "new_proposal",
): string {
  const rawTitle = item.title?.trim() || "Untitled Blackboard item";
  const course = item.courseCode?.trim();

  let itemLabel = rawTitle;
  if (course) {
    const courseUpper = course.toUpperCase();
    const rawUpper = rawTitle.toUpperCase();
    const alreadyPrefixed =
      rawUpper.startsWith(`[${courseUpper}]`) ||
      rawUpper.startsWith(`${courseUpper} —`) ||
      rawUpper.startsWith(`${courseUpper} -`) ||
      rawUpper.startsWith(`${courseUpper}:`);

    if (!alreadyPrefixed) {
      itemLabel = `${course} — ${rawTitle}`;
    }
  }

  switch (kind) {
    case "deadline_changed":
      return `${itemLabel} deadline was updated and is available for review.`;
    case "proposal_changed":
      return `${itemLabel} was updated and is available for review.`;
    case "divergence":
      return `${itemLabel} was updated on Blackboard. Your native task remains unchanged.`;
    case "new_proposal":
    default:
      return `${itemLabel} is available for review.`;
  }
}

export function formatBlackboardReviewDeepLink(proposalId?: string | null): string {
  if (!proposalId) return "/inbox";
  return safeDeepLink(`/inbox?proposal=${encodeURIComponent(proposalId)}`);
}

export type PlannedBlackboardNotification = {
  eventType: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string;
  courseId: string | null;
};

export function planBlackboardProposalNotification(input: {
  externalRecordId: string;
  proposalId: string | null;
  proposalStatus: "proposed" | "rejected" | "committed" | string;
  proposalRevision: string;
  previousProposalRevision?: string | null;
  title: string;
  courseCode?: string | null;
  courseId?: string | null;
  isFallbackUid?: boolean;
  isCreate?: boolean;
  deadlineChanged?: boolean;
}): PlannedBlackboardNotification | null {
  if (input.isFallbackUid) {
    return null;
  }

  const deepLink = formatBlackboardReviewDeepLink(input.proposalId);

  // 1. Newly created proposal
  if (input.isCreate) {
    if (input.proposalStatus !== "proposed") return null;
    return {
      eventType: "blackboard_assignment",
      dedupeKey: notificationDedupeKey(
        "blackboard_assignment",
        input.externalRecordId,
        input.proposalRevision,
      ),
      title: formatBlackboardNotificationTitle("new_proposal"),
      body: formatBlackboardNotificationBody(
        { title: input.title, courseCode: input.courseCode },
        "new_proposal",
      ),
      deepLink,
      courseId: input.courseId ?? null,
    };
  }

  // 2. Updated record: only notify if semantic revision materially changed
  if (
    input.previousProposalRevision &&
    input.previousProposalRevision === input.proposalRevision
  ) {
    return null;
  }

  if (input.proposalStatus === "proposed") {
    const kind: BlackboardNotificationKind = input.deadlineChanged
      ? "deadline_changed"
      : "proposal_changed";
    const eventType: NotificationType = input.deadlineChanged
      ? "blackboard_deadline_changed"
      : "blackboard_assignment";

    return {
      eventType,
      dedupeKey: notificationDedupeKey(
        eventType,
        input.externalRecordId,
        input.proposalRevision,
      ),
      title: formatBlackboardNotificationTitle(kind),
      body: formatBlackboardNotificationBody(
        { title: input.title, courseCode: input.courseCode },
        kind,
      ),
      deepLink,
      courseId: input.courseId ?? null,
    };
  }

  if (input.proposalStatus === "committed") {
    // Source divergence: native task remains untouched
    return {
      eventType: "blackboard_proposal_divergence",
      dedupeKey: notificationDedupeKey(
        "blackboard_proposal_divergence",
        input.externalRecordId,
        input.proposalRevision,
      ),
      title: formatBlackboardNotificationTitle("divergence"),
      body: formatBlackboardNotificationBody(
        { title: input.title, courseCode: input.courseCode },
        "divergence",
      ),
      deepLink,
      courseId: input.courseId ?? null,
    };
  }

  // Dismissed proposal that was not reopened, or unrecognized status: do not notify
  return null;
}

/**
 * Plans a task reminder notification.
 * Suppresses completed, submitted, and cancelled tasks.
 */
export function planTaskDueNotification(input: {
  task: Task;
  currentInstant?: Date;
  timeZone: string;
  reminderWindowHours?: number;
}): PlannedNotification | null {
  const { task, timeZone } = input;
  const now = input.currentInstant ?? new Date();
  const windowHours = input.reminderWindowHours ?? 24;

  // Completed, submitted, or cancelled tasks never generate reminders
  if (
    task.status === "completed" ||
    task.status === "submitted" ||
    task.status === "cancelled"
  ) {
    return null;
  }

  const coursePrefix = task.course ? `${task.course} — ` : "";

  // 1. Exact instant deadline (dueAt)
  if (task.dueAt) {
    const dueTime = new Date(task.dueAt).getTime();
    const nowTime = now.getTime();
    const windowMs = windowHours * 60 * 60 * 1000;

    if (nowTime > dueTime) {
      // Overdue
      return {
        eventType: "task_overdue",
        dedupeKey: notificationDedupeKey("task_overdue", task.id, task.dueAt),
        title: "Task overdue",
        body: `${coursePrefix}${task.title} was due at ${formatTime(task.dueAt, timeZone)}.`,
        deepLink: "/tasks?view=overdue",
        courseId: task.courseId ?? null,
      };
    }

    if (dueTime - nowTime <= windowMs && nowTime <= dueTime) {
      // Due soon
      return {
        eventType: "task_due_soon",
        dedupeKey: notificationDedupeKey("task_due_soon", task.id, task.dueAt),
        title: "Task due soon",
        body: `${coursePrefix}${task.title} is due at ${formatTime(task.dueAt, timeZone)}.`,
        deepLink: "/tasks?view=today",
        courseId: task.courseId ?? null,
      };
    }

    return null;
  }

  // 2. Calendar day deadline (dueDate)
  if (task.dueDate) {
    const today = todayIn(timeZone, now);
    if (task.dueDate < today) {
      return {
        eventType: "task_overdue",
        dedupeKey: notificationDedupeKey("task_overdue", task.id, task.dueDate),
        title: "Task overdue",
        body: `${coursePrefix}${task.title} was due on ${task.dueDate}.`,
        deepLink: "/tasks?view=overdue",
        courseId: task.courseId ?? null,
      };
    }

    if (task.dueDate === today) {
      return {
        eventType: "task_due_soon",
        dedupeKey: notificationDedupeKey("task_due_soon", task.id, task.dueDate),
        title: "Task due today",
        body: `${coursePrefix}${task.title} is due today.`,
        deepLink: "/tasks?view=today",
        courseId: task.courseId ?? null,
      };
    }
  }

  return null;
}

/**
 * Plans a calendar event reminder notification.
 */
export function planCalendarEventNotification(input: {
  event: CalendarEvent;
  startsAt?: string;
  timeZone: string;
}): PlannedNotification {
  const { event, timeZone } = input;
  const startInstant = input.startsAt ?? event.start;
  const timeStr = formatTime(startInstant, timeZone);
  return {
    eventType: "calendar_event_soon",
    dedupeKey: notificationDedupeKey("calendar_event_soon", event.id, startInstant),
    title: "Upcoming event",
    body: `${event.title} starts at ${timeStr}.`,
    deepLink: `/calendar`,
    courseId: null,
  };
}

/**
 * Plans a school class reminder notification.
 */
export function planSchoolClassNotification(input: {
  course: Course;
  meeting: PersistedCourseMeeting | CourseMeeting;
  occurrenceInstant: string;
  timeZone: string;
}): PlannedNotification {
  const { course, meeting, occurrenceInstant, timeZone } = input;
  const timeStr = formatTime(occurrenceInstant, timeZone);
  const meetingLocation =
    "location" in meeting && typeof meeting.location === "string"
      ? meeting.location
      : null;
  const location = meetingLocation || course.location;
  const locationSuffix = location ? ` in ${location}` : "";
  const courseCode = course.code || course.name;

  return {
    eventType: "school_class_soon",
    dedupeKey: notificationDedupeKey(
      "school_class_soon",
      `${course.id}:${meeting.id}`,
      occurrenceInstant,
    ),
    title: "Upcoming class",
    body: `${courseCode} class starts at ${timeStr}${locationSuffix}.`,
    deepLink: `/school`,
    courseId: course.id,
  };
}

function formatTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Formats a notification creation timestamp relative to `now` in the user's timezone.
 */
export function formatNotificationTimestamp(
  dateStr: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  try {
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    const eventDay = todayIn(timeZone, date);
    const today = todayIn(timeZone, now);

    if (eventDay === today) {
      return formatTime(dateStr, timeZone);
    }

    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return dateStr;
  }
}

/**
 * Groups notifications into chronological sections ("today", "yesterday", "earlier").
 */
export function groupNotificationsByDate(
  notifications: NotificationEvent[],
  timeZone: string,
  now: Date = new Date(),
): {
  today: NotificationEvent[];
  yesterday: NotificationEvent[];
  earlier: NotificationEvent[];
} {
  const today = todayIn(timeZone, now);
  const yesterdayDate = new Date(now.getTime() - 86_400_000);
  const yesterday = todayIn(timeZone, yesterdayDate);

  const result = {
    today: [] as NotificationEvent[],
    yesterday: [] as NotificationEvent[],
    earlier: [] as NotificationEvent[],
  };

  for (const item of notifications) {
    const itemDay = todayIn(timeZone, new Date(item.createdAt));
    if (itemDay === today) {
      result.today.push(item);
    } else if (itemDay === yesterday) {
      result.yesterday.push(item);
    } else {
      result.earlier.push(item);
    }
  }

  return result;
}

/**
 * Evaluates whether a push notification delivery is stale/expired.
 * Used when quiet hours end, or when dispatching pending deliveries,
 * to prevent disturbing the user for events whose useful moment has passed.
 */
export function isNotificationDeliveryStale(
  event: {
    eventType: string;
    dedupeKey: string;
    createdAt: string;
  },
  currentInstant: Date = new Date(),
): boolean {
  const nowMs = currentInstant.getTime();
  const createdMs = Date.parse(event.createdAt);
  const ageMs = Number.isNaN(createdMs) ? 0 : nowMs - createdMs;

  // 1. School class reminders: stale 15 minutes after the class start time
  if (event.eventType === "school_class_soon") {
    const parts = event.dedupeKey.split(":");
    // dedupeKey: school_class_soon:<courseId>:<meetingId>:<occurrenceInstant>
    const occurrenceInstant = parts.slice(3).join(":");
    if (occurrenceInstant) {
      const occurrenceMs = Date.parse(occurrenceInstant);
      if (!Number.isNaN(occurrenceMs)) {
        return nowMs > occurrenceMs + 15 * 60_000;
      }
    }
    return ageMs > 2 * 3600_000;
  }

  // 2. Calendar event reminders: stale 15 minutes after event starts
  if (event.eventType === "calendar_event_soon") {
    const parts = event.dedupeKey.split(":");
    // dedupeKey: calendar_event_soon:<eventId>:<startInstant>
    const startInstant = parts.slice(2).join(":");
    if (startInstant) {
      const startMs = Date.parse(startInstant);
      if (!Number.isNaN(startMs)) {
        return nowMs > startMs + 15 * 60_000;
      }
    }
    return ageMs > 2 * 3600_000;
  }

  // 3. Task due soon / reminders: stale after 24 hours
  if (event.eventType === "task_due_soon" || event.eventType === "due_reminder") {
    return ageMs > 24 * 3600_000;
  }

  // 4. Task overdue: stale after 48 hours
  if (event.eventType === "task_overdue") {
    return ageMs > 48 * 3600_000;
  }

  // 5. Blackboard proposals: stale after 7 days
  if (event.eventType.startsWith("blackboard_")) {
    return ageMs > 7 * 24 * 3600_000;
  }

  // 6. System sync failures: stale after 24 hours
  if (event.eventType === "sync_failure") {
    return ageMs > 24 * 3600_000;
  }

  // Default fallback: 24 hours
  return ageMs > 24 * 3600_000;
}
