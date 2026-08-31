import "server-only";

import { createHash } from "node:crypto";

import { projectTodayClasses } from "@/features/home/home-classes";
import type { CalendarEvent } from "@/types/calendar-event";
import type { CourseWithMeetings, PersistedCourseMeeting } from "@/types/course";
import type { Task, TaskStatus } from "@/types/task";
import { todayIn } from "@/lib/date/day";
import {
  isNotificationDeliveryStale,
  isQuietHours,
  planCalendarEventNotification,
  planSchoolClassNotification,
  planTaskDueNotification,
  safeNotificationPayload,
} from "./notification-domain";
import {
  claimPendingPushDelivery,
  createNotificationEvent,
  disablePushSubscription,
  failStalePushDeliveryClaims,
  getNotificationPreferences,
  isNotificationEventEnabled,
  listDeferredPushDeliveries,
  listPendingPushDeliveries,
  updateDeliveryStatus,
  type AuthenticatedClient,
  type PushDeliveryWithDetails,
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

function dedupeSourceAndRevision(
  dedupeKey: string,
  eventType: string,
): { sourceId: string; revision: string } | null {
  const prefix = `${eventType}:`;
  if (!dedupeKey.startsWith(prefix)) return null;
  const remainder = dedupeKey.slice(prefix.length);
  const separator = remainder.indexOf(":");
  if (separator <= 0 || separator === remainder.length - 1) return null;
  return {
    sourceId: remainder.slice(0, separator),
    revision: remainder.slice(separator + 1),
  };
}

async function isDeliverySourceCurrent(
  client: AuthenticatedClient,
  userId: string,
  delivery: PushDeliveryWithDetails,
  currentInstant: Date,
  timeZone: string,
): Promise<boolean> {
  const { event } = delivery;

  if (event.eventType.startsWith("task_")) {
    const identity = dedupeSourceAndRevision(
      event.dedupeKey,
      event.eventType,
    );
    if (!identity) return false;
    const { data, error } = await client
      .from("tasks")
      .select("status,due_date,due_at")
      .eq("user_id", userId)
      .eq("id", identity.sourceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const task = data as {
      status: string;
      due_date: string | null;
      due_at: string | null;
    };
    if (
      (task.status !== "todo" && task.status !== "in_progress") ||
      (task.due_at ?? task.due_date) !== identity.revision
    ) {
      return false;
    }
    if (event.eventType === "task_due_soon") {
      return task.due_at
        ? currentInstant.getTime() <= Date.parse(task.due_at)
        : task.due_date === todayIn(timeZone, currentInstant);
    }
    return true;
  }

  if (event.eventType === "calendar_event_soon") {
    const identity = dedupeSourceAndRevision(
      event.dedupeKey,
      event.eventType,
    );
    if (!identity) return false;
    const { data, error } = await client
      .from("calendar_events")
      .select("starts_at,all_day")
      .eq("user_id", userId)
      .eq("id", identity.sourceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const calendarEvent = data as { starts_at: string; all_day: boolean };
    return !calendarEvent.all_day && calendarEvent.starts_at === identity.revision;
  }

  if (event.eventType === "school_class_soon") {
    const parts = event.dedupeKey.split(":");
    if (parts.length < 5) return false;
    const courseId = parts[1];
    const meetingId = parts[2];
    const occurrenceInstant = parts.slice(3).join(":");
    if (Number.isNaN(Date.parse(occurrenceInstant))) return false;
    const [courseResult, meetingResult] = await Promise.all([
      client
        .from("courses")
        .select("id,code,name,instructor,location,color,archived_at")
        .eq("user_id", userId)
        .eq("id", courseId)
        .maybeSingle(),
      client
        .from("course_meetings")
        .select(
          "id,course_id,title,weekdays,start_date,end_date_exclusive,start_time,end_time,time_zone,location",
        )
        .eq("user_id", userId)
        .eq("id", meetingId)
        .maybeSingle(),
    ]);
    if (courseResult.error) throw courseResult.error;
    if (meetingResult.error) throw meetingResult.error;
    if (!courseResult.data || !meetingResult.data) {
      return false;
    }

    const courseRow = courseResult.data as {
      id: string;
      code: string;
      name: string;
      instructor: string | null;
      location: string | null;
      color: string | null;
      archived_at: string | null;
    };
    const meetingRow = meetingResult.data as {
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
    };
    if (courseRow.archived_at || meetingRow.course_id !== courseRow.id) return false;

    const occurrenceCourse: CourseWithMeetings = {
      id: courseRow.id,
      code: courseRow.code,
      name: courseRow.name,
      instructor: courseRow.instructor,
      location: courseRow.location,
      color: courseRow.color,
      archivedAt: courseRow.archived_at,
      meetings: [
        {
          id: meetingRow.id,
          courseId: meetingRow.course_id,
          title: meetingRow.title,
          weekdays: meetingRow.weekdays,
          startDate: meetingRow.start_date,
          endDateExclusive: meetingRow.end_date_exclusive,
          startTime: meetingRow.start_time.slice(0, 5),
          endTime: meetingRow.end_time.slice(0, 5),
          timeZone: meetingRow.time_zone,
          location: meetingRow.location,
        },
      ],
    };
    return projectTodayClasses(
      [occurrenceCourse],
      timeZone,
      new Date(occurrenceInstant),
    ).some(
      (occurrence) =>
        occurrence.meetingId === meetingId &&
        occurrence.startInstant === occurrenceInstant,
    );
  }

  if (event.eventType.startsWith("blackboard_")) {
    const identity = dedupeSourceAndRevision(
      event.dedupeKey,
      event.eventType,
    );
    if (!identity) return false;
    const [recordResult, proposalResult] = await Promise.all([
      client
        .from("external_records")
        .select("proposal_revision,missing_since")
        .eq("user_id", userId)
        .eq("id", identity.sourceId)
        .maybeSingle(),
      client
        .from("capture_proposals")
        .select("status,source_revision")
        .eq("user_id", userId)
        .eq("external_record_id", identity.sourceId)
        .maybeSingle(),
    ]);
    if (recordResult.error) throw recordResult.error;
    if (proposalResult.error) throw proposalResult.error;
    if (!recordResult.data || !proposalResult.data) return false;
    const data = recordResult.data;
    const record = data as {
      proposal_revision: string | null;
      missing_since: string | null;
    };
    const proposal = proposalResult.data as {
      status: string;
      source_revision: string | null;
    };
    const expectedStatus =
      event.eventType === "blackboard_proposal_divergence"
        ? "committed"
        : "proposed";
    return (
      !record.missing_since &&
      record.proposal_revision === identity.revision &&
      proposal.source_revision === identity.revision &&
      proposal.status === expectedStatus
    );
  }

  return !isNotificationDeliveryStale(event, currentInstant);
}

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
        currentInstant,
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
      currentInstant,
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
          currentInstant,
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
      continue;
    }

    const enabled = await isNotificationEventEnabled(
      client,
      userId,
      delivery.event.eventType,
      delivery.event.courseId,
    );
    const sourceCurrent = enabled
      ? await isDeliverySourceCurrent(
          client,
          userId,
          delivery,
          currentInstant,
          timeZone,
        )
      : false;
    if (!enabled || !sourceCurrent) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: !enabled
          ? "disabled_by_preference"
          : "source_changed_or_unavailable",
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

  await failStalePushDeliveryClaims(
    client,
    userId,
    new Date(currentInstant.getTime() - 15 * 60_000).toISOString(),
  );

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

    // 3. Check current preferences, source state, and expiry immediately before egress.
    const enabled = await isNotificationEventEnabled(
      client,
      userId,
      delivery.event.eventType,
      delivery.event.courseId,
    );
    if (!enabled) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: "disabled_by_preference",
      });
      expired++;
      continue;
    }

    const sourceCurrent = await isDeliverySourceCurrent(
      client,
      userId,
      delivery,
      currentInstant,
      timeZone,
    );
    if (!sourceCurrent) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: "source_changed_or_unavailable",
      });
      expired++;
      continue;
    }

    if (isNotificationDeliveryStale(delivery.event, currentInstant)) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "unavailable",
        errorCode: "expired",
      });
      expired++;
      continue;
    }

    // 4. Claim atomically so concurrent dispatchers cannot send the same row.
    const claimedAt = currentInstant.toISOString();
    const claimed = await claimPendingPushDelivery(
      client,
      userId,
      delivery.id,
      claimedAt,
    );
    if (!claimed) continue;

    // 5. Send Web Push. Claims are at-most-once: ambiguous network outcomes are
    // terminal rather than automatically retried and potentially duplicated.
    const payload = safeNotificationPayload(delivery.event);
    payload.dedupeKey = `event-${createHash("sha256")
      .update(delivery.event.dedupeKey)
      .digest("base64url")
      .slice(0, 24)}`;
    const sendResult = await sendWebPushNotification({
      subscription: delivery.subscription,
      payload,
      fetchImpl,
    });

    if (sendResult.ok) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "sent",
        deliveredAt: currentInstant.toISOString(),
        claimedAt: null,
        errorCode: null,
      });
      sent++;
    } else if (sendResult.permanentFailure) {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "failed",
        errorCode: sendResult.errorCode,
        attemptedAt: claimedAt,
        claimedAt: null,
      });
      await disablePushSubscription(client, userId, delivery.subscription.id);
      failed++;
    } else {
      await updateDeliveryStatus(client, userId, delivery.id, {
        status: "failed",
        errorCode: sendResult.errorCode,
        attemptedAt: claimedAt,
        claimedAt: null,
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

  // 1. Evaluate Tasks. Event creation resolves the effective global/course
  // preference; a global off switch must not hide an explicit course override.
  const taskResult = await evaluateTasks(
    client,
    userId,
    currentInstant,
    timeZone,
  );

  // 2. Evaluate Calendar Events
  const calResult = await evaluateCalendarEvents(
    client,
    userId,
    currentInstant,
    timeZone,
  );

  // 3. Evaluate School Classes
  const schoolResult = await evaluateSchoolClasses(
    client,
    userId,
    currentInstant,
    timeZone,
  );

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
