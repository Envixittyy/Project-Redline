import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isQuietHours,
  safeNotificationPayload,
  type NotificationType,
} from "./notification-domain";

export type AuthenticatedClient = SupabaseClient;

type NotificationPreferenceRow = {
  id: string;
  course_id: string | null;
  notification_type: string;
  enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  time_zone: string;
  daily_digest: boolean;
};

type PushSubscriptionRow = {
  id: string;
  expires_at: string | null;
  disabled_at: string | null;
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

export type CreateNotificationEventResult = {
  created: boolean;
  eventId?: string;
  suppressedReason?: "disabled_by_preference" | "duplicate" | null;
  inQuietHours?: boolean;
};

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
    .select("id,course_id,notification_type,enabled,quiet_start,quiet_end,time_zone,daily_digest")
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
          (p.notification_type === input.eventType || p.notification_type === "all"),
      )
    : undefined;

  const globalPref = prefRows.find(
    (p) =>
      p.course_id === null &&
      (p.notification_type === input.eventType || p.notification_type === "all"),
  );

  const activePref = coursePref ?? globalPref;

  if (activePref && !activePref.enabled) {
    return { created: false, suppressedReason: "disabled_by_preference" };
  }

  // 2. Check quiet hours
  const timeZone = activePref?.time_zone || process.env.APP_TIME_ZONE || "Asia/Manila";
  const inQuiet = isQuietHours(
    new Date(),
    timeZone,
    activePref?.quiet_start ?? null,
    activePref?.quiet_end ?? null,
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

export async function listUnreadNotifications(
  client: AuthenticatedClient,
  userId: string,
  limit = 20,
) {
  const { data, error } = await client
    .from("notification_events")
    .select("id,event_type,title,body,deep_link,course_id,created_at")
    .eq("user_id", userId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(
  client: AuthenticatedClient,
  userId: string,
  eventId: string,
) {
  const { error } = await client
    .from("notification_events")
    .update({ read_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("user_id", userId);

  if (error) throw error;
}
