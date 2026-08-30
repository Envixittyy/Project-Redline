import "server-only";

import { projectTodayClasses } from "@/features/home/home-classes";
import type { CalendarEvent } from "@/types/calendar-event";
import type { CourseWithMeetings, PersistedCourseMeeting } from "@/types/course";
import type { Task, TaskStatus } from "@/types/task";
import {
  isNotificationDeliveryStale,
  isQuietHours,
  planCalendarEventNotification,
  planSchoolClassNotification,
  planTaskDueNotification,
  safeNotificationPayload,
} from "./notification-domain";
import {
  createNotificationEvent,
  disablePushSubscription,
  getNotificationPreferences,
  listDeferredPushDeliveries,
  listPendingPushDeliveries,
  updateDeliveryStatus,
  type AuthenticatedClient,
} from "./notification-repository";
import { sendWebPushNotification } from "./web-push-client";

export type DispatchSummary = {
  tasksEvaluated: number;
  taskNotificationsPlanned: number;
  calendarEvaluated: number;
  calendarNotificationsPlanned: number;
  schoolEvaluated: number;
  schoolNotificationsPlanned: number;
  deferredReconciled: number;
  deferredExpired: number;
  pushesSent: number;
  pushesFailed: number;
  pushesDeferred: number;
  pushesExpired: number;
};

/**
 * Evaluates active tasks and generates due / overdue notifications.
 */
async function evaluateTasks(
  client: AuthenticatedClient,
  userId: string,
  currentInstant: Date,
  timeZone: string,
): Promise<{ evaluated: number; planned: number }> {
  // Query active open tasks
  const { data, error } = await client
    .from("tasks")
    .select(
      "id, title, description, status, priority, due_date, due_at, scheduled_start, scheduled_end, area, project, course, course_id, parent_task_id, created_at, updated_at, completed_at",
    )
    .eq("user_id", userId)
    .in("status", ["todo", "in_progress"]);

  if (error) {
    console.error("[dispatcher] evaluateTasks failed:", error);
    return { evaluated: 0, planned: 0 };
  }

  const tasks = (data ?? []) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: "low" | "medium" | "high" | "urgent";
    due_date: string | null;
    due_at: string | null;
    scheduled_start: string | null;
    scheduled_end: string | null;
    area: string | null;
    project: string | null;
    course: string | null;
    course_id: string | null;
    parent_task_id: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>;

  let plannedCount = 0;

  for (const row of tasks) {
    const task: Task = {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueDate: row.due_date,
      dueAt: row.due_at,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      area: row.area,
      project: row.project,
      course: row.course,
      courseId: row.course_id,
      parentTaskId: row.parent_task_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };

    const planned = planTaskDueNotification({
      task,
      currentInstant,
      timeZone,
      reminderWindowHours: 24,
    });

    if (planned) {
      const res = await createNotificationEvent(client, {
        userId,
        eventType: planned.eventType,
        dedupeKey: planned.dedupeKey,
        title: planned.title,
        body: planned.body,
        deepLink: planned.deepLink,
        courseId: planned.courseId,
      });
      if (res.created) {
        plannedCount++;
      }
    }
  }

  return { evaluated: tasks.length, planned: plannedCount };
}

/**
 * Evaluates upcoming calendar events starting in the reminder window.
 */
async function evaluateCalendarEvents(
  client: AuthenticatedClient,
  userId: string,
  currentInstant: Date,
  timeZone: string,
): Promise<{ evaluated: number; planned: number }> {
  const windowStart = new Date(currentInstant.getTime() - 5 * 60_000).toISOString();
  const windowEnd = new Date(currentInstant.getTime() + 45 * 60_000).toISOString();

  const { data, error } = await client
    .from("calendar_events")
    .select(
      "id, title, description, starts_at, ends_at, all_day, event_type, source, external_id, source_url, course, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("all_day", false)
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd);

  if (error) {
    console.error("[dispatcher] evaluateCalendarEvents failed:", error);
    return { evaluated: 0, planned: 0 };
  }

  const events = (data ?? []) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    event_type: string;
    source: "life_os" | "blackboard" | "google_calendar";
    external_id: string | null;
    source_url: string | null;
    course: string | null;
    created_at: string;
    updated_at: string;
  }>;

  let plannedCount = 0;

  for (const row of events) {
    const calEvent: CalendarEvent = {
      id: row.id,
      title: row.title,
      description: row.description,
      start: row.starts_at,
      end: row.ends_at,
      allDay: row.all_day,
      eventType: row.event_type,
      source: row.source,
      externalId: row.external_id,
      sourceUrl: row.source_url,
      course: row.course,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    const planned = planCalendarEventNotification({
      event: calEvent,
      startsAt: calEvent.start,
      timeZone,
    });

    const res = await createNotificationEvent(client, {
      userId,
      eventType: planned.eventType,
      dedupeKey: planned.dedupeKey,
      title: planned.title,
      body: planned.body,
      deepLink: planned.deepLink,
      courseId: null,
    });

    if (res.created) {
      plannedCount++;
    }
  }

  return { evaluated: events.length, planned: plannedCount };
}

/**
 * Evaluates upcoming school classes starting in the reminder window.
 */
async function evaluateSchoolClasses(
  client: AuthenticatedClient,
  userId: string,
  currentInstant: Date,
  timeZone: string,
): Promise<{ evaluated: number; planned: number }> {
  const [coursesRes, meetingsRes] = await Promise.all([
    client
      .from("courses")
      .select("id, code, name, instructor, location, color, archived_at")
      .eq("user_id", userId)
      .is("archived_at", null),
    client
      .from("course_meetings")
      .select(
        "id, course_id, title, weekdays, start_date, end_date_exclusive, start_time, end_time, time_zone, location",
      )
      .eq("user_id", userId),
  ]);

  if (coursesRes.error || meetingsRes.error) {
    console.error(
      "[dispatcher] evaluateSchoolClasses failed:",
      coursesRes.error || meetingsRes.error,
    );
    return { evaluated: 0, planned: 0 };
  }

  const meetingsByCourse = new Map<string, PersistedCourseMeeting[]>();
  for (const m of (meetingsRes.data ?? []) as unknown as Array<{
    id: string;
    course_id: string;
    title: string;
    weekdays: number[];
    start_date: string;
    end_date_exclusive: string | null;
    start_time: string;
    end_time: string;
    time_zone: string;
    location: string | null;
  }>) {
    const list = meetingsByCourse.get(m.course_id) ?? [];
    list.push({
      id: m.id,
      courseId: m.course_id,
      title: m.title,
      weekdays: m.weekdays,
      startDate: m.start_date,
      endDateExclusive: m.end_date_exclusive,
      startTime: m.start_time.slice(0, 5),
      endTime: m.end_time.slice(0, 5),
      timeZone: m.time_zone,
      location: m.location,
    });
    meetingsByCourse.set(m.course_id, list);
  }

  const coursesWithMeetings: CourseWithMeetings[] = (
    (coursesRes.data ?? []) as unknown as Array<{
      id: string;
      code: string;
      name: string;
      instructor: string | null;
      location: string | null;
      color: string | null;
      archived_at: string | null;
    }>
  ).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    instructor: c.instructor,
    location: c.location,
    color: c.color,
    archivedAt: c.archived_at,
    meetings: meetingsByCourse.get(c.id) ?? [],
  }));

  const todayOccurrences = projectTodayClasses(
    coursesWithMeetings,
    timeZone,
    currentInstant,
  );

  let plannedCount = 0;

  for (const occ of todayOccurrences) {
    // Notify if class starts within next 30 minutes and has not already started
    if (occ.startsInMinutes >= 0 && occ.startsInMinutes <= 30) {
      const course = coursesWithMeetings.find((c) => c.id === occ.courseId);
      const meeting = course?.meetings.find((m) => m.id === occ.meetingId);
      if (course && meeting) {
        const planned = planSchoolClassNotification({
          course,
          meeting,
          occurrenceInstant: occ.startInstant,
          timeZone,
        });

        const res = await createNotificationEvent(client, {
          userId,
          eventType: planned.eventType,
          dedupeKey: planned.dedupeKey,
          title: planned.title,
          body: planned.body,
          deepLink: planned.deepLink,
          courseId: planned.courseId,
        });

        if (res.created) {
          plannedCount++;
        }
      }
    }
  }

  return { evaluated: todayOccurrences.length, planned: plannedCount };
}

/**
 * Reconciles deferred push deliveries after quiet hours have ended.
 */
async function reconcileDeferredDeliveries(
  client: AuthenticatedClient,
  userId: string,
  currentInstant: Date,
  timeZone: string,
  quietStart: string | null,
  quietEnd: string | null,
): Promise<{ reconciled: number; expired: number }> {
  const inQuiet = isQuietHours(currentInstant, timeZone, quietStart, quietEnd);
  if (inQuiet) {
    // Still in quiet hours: leave deferred
    return { reconciled: 0, expired: 0 };
  }

  const deferredList = await listDeferredPushDeliveries(client, userId, 50);
  let reconciled = 0;
  let expired = 0;

  for (const delivery of deferredList) {
    const isStale = isNotificationDeliveryStale(delivery.event, currentInstant);
    if (isStale) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: "expired_during_quiet_hours",
      });
      expired++;
    } else {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "pending",
      });
      reconciled++;
    }
  }

  return { reconciled, expired };
}

/**
 * Dispatches all pending Web Push deliveries.
 */
async function dispatchPendingDeliveries(
  client: AuthenticatedClient,
  userId: string,
  currentInstant: Date,
  timeZone: string,
  quietStart: string | null,
  quietEnd: string | null,
  fetchImpl?: typeof fetch,
): Promise<{ sent: number; failed: number; deferred: number; expired: number }> {
  const inQuiet = isQuietHours(currentInstant, timeZone, quietStart, quietEnd);

  const pendingList = await listPendingPushDeliveries(client, userId, 50);
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let expired = 0;

  for (const delivery of pendingList) {
    // 1. If currently in quiet hours, defer
    if (inQuiet) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "deferred",
      });
      deferred++;
      continue;
    }

    // 2. Check if delivery has an active subscription
    if (!delivery.subscription || delivery.subscription.disabledAt) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: "subscription_disabled",
      });
      failed++;
      continue;
    }

    // 3. Check if notification has expired
    if (isNotificationDeliveryStale(delivery.event, currentInstant)) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: "expired",
      });
      expired++;
      continue;
    }

    // 4. Send Web Push
    const payload = safeNotificationPayload(delivery.event);
    const sendResult = await sendWebPushNotification({
      subscription: delivery.subscription,
      payload,
      fetchImpl,
    });

    if (sendResult.ok) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "sent",
        deliveredAt: new Date().toISOString(),
      });
      sent++;
    } else if (sendResult.permanentFailure) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "failed",
        errorCode: sendResult.errorCode,
        attemptedAt: new Date().toISOString(),
      });
      await disablePushSubscription(client, userId, delivery.subscription.id);
      failed++;
    } else {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "failed",
        errorCode: sendResult.errorCode,
        attemptedAt: new Date().toISOString(),
      });
      failed++;
    }
  }

  return { sent, failed, deferred, expired };
}

/**
 * Main dispatcher entrypoint. Evaluates all notification sources and dispatches Web Push.
 */
export async function evaluateAndDispatchNotifications(
  client: AuthenticatedClient,
  userId: string,
  options?: {
    currentInstant?: Date;
    fetchImpl?: typeof fetch;
  },
): Promise<DispatchSummary> {
  const currentInstant = options?.currentInstant ?? new Date();
  const preferences = await getNotificationPreferences(client, userId);
  const timeZone =
    preferences.timeZone || process.env.APP_TIME_ZONE || "Asia/Manila";

  // 1. Evaluate Tasks
  const taskResult = preferences.taskReminders
    ? await evaluateTasks(client, userId, currentInstant, timeZone)
    : { evaluated: 0, planned: 0 };

  // 2. Evaluate Calendar Events
  const calResult = preferences.calendarReminders
    ? await evaluateCalendarEvents(client, userId, currentInstant, timeZone)
    : { evaluated: 0, planned: 0 };

  // 3. Evaluate School Classes
  const schoolResult = preferences.schoolClassReminders
    ? await evaluateSchoolClasses(client, userId, currentInstant, timeZone)
    : { evaluated: 0, planned: 0 };

  // 4. Reconcile Deferred Push Deliveries (post quiet hours)
  const deferredResult = await reconcileDeferredDeliveries(
    client,
    userId,
    currentInstant,
    timeZone,
    preferences.quietHoursStart,
    preferences.quietHoursEnd,
  );

  // 5. Dispatch Pending Push Deliveries
  const pushResult = await dispatchPendingDeliveries(
    client,
    userId,
    currentInstant,
    timeZone,
    preferences.quietHoursStart,
    preferences.quietHoursEnd,
    options?.fetchImpl,
  );

  return {
    tasksEvaluated: taskResult.evaluated,
    taskNotificationsPlanned: taskResult.planned,
    calendarEvaluated: calResult.evaluated,
    calendarNotificationsPlanned: calResult.planned,
    schoolEvaluated: schoolResult.evaluated,
    schoolNotificationsPlanned: schoolResult.planned,
    deferredReconciled: deferredResult.reconciled,
    deferredExpired: deferredResult.expired,
    pushesSent: pushResult.sent,
    pushesFailed: pushResult.failed,
    pushesDeferred: pushResult.deferred,
    pushesExpired: pushResult.expired,
  };
}
