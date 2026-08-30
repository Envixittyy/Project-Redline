import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isQuietHours,
  safeNotificationPayload,
  type NotificationType,
} from "./notification-domain";
import type {
  CreateNotificationEventInput,
  NotificationEvent,
  NotificationPreferencesState,
} from "@/types/notification";

export type AuthenticatedClient = SupabaseClient;

type NotificationPreferenceRow = {
  id: string;
  user_id: string;
  course_id: string | null;
  notification_type: string;
  enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  time_zone: string;
  daily_digest: boolean;
};

type NotificationEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  dedupe_key: string;
  title: string;
  body: string;
  deep_link: string;
  course_id: string | null;
  read_at: string | null;
  created_at: string;
};

type PushSubscriptionRow = {
  id: string;
  expires_at: string | null;
  disabled_at: string | null;
};

export type CreateNotificationEventResult = {
  created: boolean;
  eventId?: string;
  suppressedReason?: "disabled_by_preference" | "duplicate" | null;
  inQuietHours?: boolean;
};

function mapNotificationEvent(row: NotificationEventRow): NotificationEvent {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type as NotificationType,
    dedupeKey: row.dedupe_key,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    courseId: row.course_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * Checks whether an event type matches a preference row type.
 */
function preferenceMatchesType(prefType: string, eventType: string): boolean {
  if (prefType === "all" || prefType === eventType) return true;
  if (
    (prefType === "tasks" || prefType === "task_reminders") &&
    (eventType.startsWith("task_") || eventType === "due_reminder")
  ) {
    return true;
  }
  if (
    (prefType === "calendar" || prefType === "calendar_reminders") &&
    eventType.startsWith("calendar_")
  ) {
    return true;
  }
  if (
    (prefType === "school" || prefType === "school_class_reminders") &&
    eventType.startsWith("school_")
  ) {
    return true;
  }
  if (
    (prefType === "blackboard" || prefType === "blackboard_new_items") &&
    eventType === "blackboard_assignment"
  ) {
    return true;
  }
  if (
    (prefType === "blackboard" || prefType === "blackboard_deadline_changes") &&
    (eventType === "blackboard_deadline_changed" ||
      eventType === "blackboard_proposal_divergence")
  ) {
    return true;
  }
  return false;
}

/**
 * Creates an in-app notification event and sets up delivery records (in_app and web_push).
 * Reuses the Phase 4D notification schema and contracts:
 * - Checks user notification preferences (including course-level and type-level toggles)
 * - Evaluates quiet hours: push deliveries are marked 'deferred' without suppressing in-app notifications
 * - Enforces deduplication idempotently via (user_id, dedupe_key)
 */
export async function createNotificationEvent(
  client: AuthenticatedClient,
  input: CreateNotificationEventInput,
): Promise<CreateNotificationEventResult> {
  // 1. Check preferences
  let preferenceQuery = client
    .from("notification_preferences")
    .select("id,user_id,course_id,notification_type,enabled,quiet_start,quiet_end,time_zone,daily_digest")
    .eq("user_id", input.userId);

  if (input.courseId) {
    preferenceQuery = preferenceQuery.or(
      `course_id.eq.${input.courseId},course_id.is.null`,
    );
  } else {
    preferenceQuery = preferenceQuery.is("course_id", null);
  }

  const { data: preferences, error: prefError } = await preferenceQuery;
  if (prefError) {
    console.error("[notifications] Failed to load preferences:", prefError);
  }

  const prefRows = (preferences ?? []) as NotificationPreferenceRow[];

  // Course-specific preference takes precedence over global preference
  const coursePref = input.courseId
    ? prefRows.find(
        (p) =>
          p.course_id === input.courseId &&
          preferenceMatchesType(p.notification_type, input.eventType),
      )
    : undefined;

  const globalPref = prefRows.find(
    (p) =>
      p.course_id === null &&
      preferenceMatchesType(p.notification_type, input.eventType),
  );

  const activePref = coursePref ?? globalPref;

  if (activePref && !activePref.enabled) {
    return { created: false, suppressedReason: "disabled_by_preference" };
  }

  // 2. Check quiet hours
  const timeZone =
    prefRows.find((p) => p.time_zone)?.time_zone ||
    process.env.APP_TIME_ZONE ||
    "Asia/Manila";

  const quietPref = prefRows.find((p) => p.quiet_start && p.quiet_end) ?? activePref;
  const inQuiet = isQuietHours(
    new Date(),
    timeZone,
    quietPref?.quiet_start ?? null,
    quietPref?.quiet_end ?? null,
  );

  // 3. Sanitize payload
  const sanitized = safeNotificationPayload({
    title: input.title,
    body: input.body,
    deepLink: input.deepLink,
    dedupeKey: input.dedupeKey,
  });

  // 4. Upsert notification event idempotently
  const { data: eventData, error: eventError } = await client
    .from("notification_events")
    .upsert(
      {
        user_id: input.userId,
        event_type: input.eventType,
        dedupe_key: sanitized.dedupeKey,
        title: sanitized.title,
        body: sanitized.body,
        deep_link: sanitized.url,
        course_id: input.courseId ?? null,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (eventError) {
    console.error("[notifications] Failed to insert notification event:", eventError);
    throw eventError;
  }

  if (!eventData) {
    return { created: false, suppressedReason: "duplicate" };
  }

  const eventId = eventData.id;

  // 5. Create in-app delivery row
  const inAppDelivery = await client.from("notification_deliveries").insert({
    user_id: input.userId,
    notification_event_id: eventId,
    push_subscription_id: null,
    channel: "in_app",
    status: "sent",
    delivered_at: new Date().toISOString(),
  });

  if (inAppDelivery.error) {
    console.error("[notifications] Failed to record in-app delivery:", inAppDelivery.error);
  }

  // 6. Create Web Push delivery rows for active subscriptions
  const { data: subscriptions, error: subError } = await client
    .from("push_subscriptions")
    .select("id,expires_at,disabled_at")
    .eq("user_id", input.userId)
    .is("disabled_at", null);

  if (subError) {
    console.error("[notifications] Failed to query push subscriptions:", subError);
  }

  const activeSubs = ((subscriptions ?? []) as PushSubscriptionRow[]).filter((sub) => {
    if (!sub.expires_at) return true;
    return new Date(sub.expires_at) > new Date();
  });

  if (activeSubs.length > 0) {
    const pushDeliveries = activeSubs.map((sub) => ({
      user_id: input.userId,
      notification_event_id: eventId,
      push_subscription_id: sub.id,
      channel: "web_push",
      status: inQuiet ? "deferred" : "pending",
    }));

    const { error: pushInsertError } = await client
      .from("notification_deliveries")
      .insert(pushDeliveries);

    if (pushInsertError) {
      console.error("[notifications] Failed to record push deliveries:", pushInsertError);
    }
  }

  return {
    created: true,
    eventId,
    inQuietHours: inQuiet,
    suppressedReason: null,
  };
}

/**
 * Lists notifications for a user, ordered by creation date descending.
 */
export async function listNotifications(
  client: AuthenticatedClient,
  userId: string,
  options?: { limit?: number; unreadOnly?: boolean },
): Promise<NotificationEvent[]> {
  const limit = options?.limit ?? 50;
  let query = client
    .from("notification_events")
    .select("id,user_id,event_type,dedupe_key,title,body,deep_link,course_id,read_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[notifications] listNotifications failed:", error);
    throw error;
  }

  return ((data ?? []) as NotificationEventRow[]).map(mapNotificationEvent);
}

/**
 * Gets exact unread notification count for a user.
 */
export async function getUnreadNotificationCount(
  client: AuthenticatedClient,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from("notification_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    console.error("[notifications] getUnreadNotificationCount failed:", error);
    throw error;
  }

  return count ?? 0;
}

/**
 * Backward-compatible unread list helper.
 */
export async function listUnreadNotifications(
  client: AuthenticatedClient,
  userId: string,
  limit = 20,
) {
  return listNotifications(client, userId, { limit, unreadOnly: true });
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationRead(
  client: AuthenticatedClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await client
    .from("notification_events")
    .update({ read_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("user_id", userId);

  if (error) throw error;
}

/**
 * Marks a single notification as unread.
 */
export async function markNotificationUnread(
  client: AuthenticatedClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await client
    .from("notification_events")
    .update({ read_at: null })
    .eq("id", eventId)
    .eq("user_id", userId);

  if (error) throw error;
}

/**
 * Marks all unread notifications as read for a user.
 */
export async function markAllNotificationsRead(
  client: AuthenticatedClient,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("notification_events")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) throw error;
}

/**
 * Deletes a notification event.
 */
export async function deleteNotificationEvent(
  client: AuthenticatedClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const { error } = await client
    .from("notification_events")
    .delete()
    .eq("id", eventId)
    .eq("user_id", userId);

  if (error) throw error;
}

/**
 * Reads user notification preferences into structured state.
 */
export async function getNotificationPreferences(
  client: AuthenticatedClient,
  userId: string,
): Promise<NotificationPreferencesState> {
  const { data, error } = await client
    .from("notification_preferences")
    .select("id,course_id,notification_type,enabled,quiet_start,quiet_end,time_zone,daily_digest")
    .eq("user_id", userId);

  if (error) {
    console.error("[notifications] getNotificationPreferences failed:", error);
    throw error;
  }

  const rows = (data ?? []) as NotificationPreferenceRow[];
  const globalRows = rows.filter((r) => r.course_id === null);

  const getGlobalEnabled = (type: string, fallback = true): boolean => {
    const row = globalRows.find((r) => r.notification_type === type);
    return row ? row.enabled : fallback;
  };

  const quietRow = globalRows.find((r) => r.quiet_start !== null || r.quiet_end !== null);
  const tzRow = globalRows.find((r) => r.time_zone);

  return {
    taskReminders: getGlobalEnabled("task_reminders", true),
    calendarReminders: getGlobalEnabled("calendar_reminders", true),
    schoolClassReminders: getGlobalEnabled("school_class_reminders", true),
    blackboardNewItems: getGlobalEnabled("blackboard_new_items", true),
    blackboardDeadlineChanges: getGlobalEnabled("blackboard_deadline_changes", true),
    quietHoursStart: quietRow?.quiet_start ?? null,
    quietHoursEnd: quietRow?.quiet_end ?? null,
    timeZone: tzRow?.time_zone ?? process.env.APP_TIME_ZONE ?? "Asia/Manila",
    dailyDigest: globalRows.some((r) => r.daily_digest),
  };
}

/**
 * Updates or creates a notification category preference.
 */
export async function updateNotificationPreference(
  client: AuthenticatedClient,
  userId: string,
  input: {
    notificationType: string;
    enabled: boolean;
    courseId?: string | null;
  },
): Promise<void> {
  const { error } = await client.from("notification_preferences").upsert(
    {
      user_id: userId,
      course_id: input.courseId ?? null,
      notification_type: input.notificationType,
      enabled: input.enabled,
    },
    { onConflict: "user_id,course_id,notification_type" },
  );

  if (error) {
    console.error("[notifications] updateNotificationPreference failed:", error);
    throw error;
  }
}

/**
 * Updates quiet hours and timezone preferences.
 */
export async function updateQuietHours(
  client: AuthenticatedClient,
  userId: string,
  input: {
    quietStart: string | null;
    quietEnd: string | null;
    timeZone?: string;
    dailyDigest?: boolean;
  },
): Promise<void> {
  const timeZone = input.timeZone ?? process.env.APP_TIME_ZONE ?? "Asia/Manila";
  const { error } = await client.from("notification_preferences").upsert(
    {
      user_id: userId,
      course_id: null,
      notification_type: "all",
      enabled: true,
      quiet_start: input.quietStart,
      quiet_end: input.quietEnd,
      time_zone: timeZone,
      daily_digest: input.dailyDigest ?? false,
    },
    { onConflict: "user_id,course_id,notification_type" },
  );

  if (error) {
    console.error("[notifications] updateQuietHours failed:", error);
    throw error;
  }
}
