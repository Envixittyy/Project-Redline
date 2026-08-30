"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedSupabase } from "@/services/supabase/request";
import { authFailureMessage } from "@/services/supabase/errors";
import {
  createNotificationEvent,
  deleteNotificationEvent,
  getNotificationPreferences,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  updateNotificationPreference,
  updateQuietHours,
} from "@/services/notifications/notification-repository";
import type {
  NotificationEvent,
  NotificationPreferencesState,
} from "@/types/notification";
import { validateWebPushSubscription } from "@/services/notifications/web-push-client";

export type NotificationActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; message: string };

class InvalidNotificationInput extends Error {}

function requireText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidNotificationInput(`${label} is required.`);
  }
  if (value.trim().length > max) {
    throw new InvalidNotificationInput(`${label} is too long (max ${max} characters).`);
  }
  return value.trim();
}

function failure<T = void>(error: unknown): NotificationActionResult<T> {
  if (error instanceof InvalidNotificationInput) {
    return { ok: false, message: error.message };
  }
  const auth = authFailureMessage(error);
  if (auth) return { ok: false, message: auth };
  console.error("[notifications] action failed:", error);
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Notification request failed.",
  };
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/more");
  revalidatePath("/settings/notifications");
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/school");
}

export async function getNotificationsAction(
  limit = 50,
): Promise<NotificationActionResult<{ notifications: NotificationEvent[]; unreadCount: number }>> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(client, userId, { limit }),
      getUnreadNotificationCount(client, userId),
    ]);

    return { ok: true, data: { notifications, unreadCount } };
  } catch (error) {
    return failure(error);
  }
}

export async function getUnreadCountAction(): Promise<NotificationActionResult<number>> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    const count = await getUnreadNotificationCount(client, userId);
    return { ok: true, data: count };
  } catch (error) {
    return failure(error);
  }
}

export async function markNotificationReadAction(
  eventId: unknown,
): Promise<NotificationActionResult> {
  try {
    const validId = requireText(eventId, "Notification ID", 100);
    const { client, userId } = await requireAuthenticatedSupabase();
    await markNotificationRead(client, userId, validId);
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function markNotificationUnreadAction(
  eventId: unknown,
): Promise<NotificationActionResult> {
  try {
    const validId = requireText(eventId, "Notification ID", 100);
    const { client, userId } = await requireAuthenticatedSupabase();
    await markNotificationUnread(client, userId, validId);
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    await markAllNotificationsRead(client, userId);
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteNotificationAction(
  eventId: unknown,
): Promise<NotificationActionResult> {
  try {
    const validId = requireText(eventId, "Notification ID", 100);
    const { client, userId } = await requireAuthenticatedSupabase();
    await deleteNotificationEvent(client, userId, validId);
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function getNotificationPreferencesAction(): Promise<
  NotificationActionResult<NotificationPreferencesState>
> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    const preferences = await getNotificationPreferences(client, userId);
    return { ok: true, data: preferences };
  } catch (error) {
    return failure(error);
  }
}

export async function saveNotificationPreferenceAction(
  notificationType: unknown,
  enabled: unknown,
  courseId?: unknown,
): Promise<NotificationActionResult> {
  try {
    const validType = requireText(notificationType, "Notification Type", 100);
    if (typeof enabled !== "boolean") {
      throw new InvalidNotificationInput("Enabled must be a boolean.");
    }
    const validCourseId =
      typeof courseId === "string" && courseId.trim() ? courseId.trim() : null;

    const { client, userId } = await requireAuthenticatedSupabase();
    await updateNotificationPreference(client, userId, {
      notificationType: validType,
      enabled,
      courseId: validCourseId,
    });

    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function saveQuietHoursAction(
  quietStart: unknown,
  quietEnd: unknown,
  timeZone: unknown,
  dailyDigest?: unknown,
): Promise<NotificationActionResult> {
  try {
    const startStr =
      typeof quietStart === "string" && quietStart.trim() ? quietStart.trim() : null;
    const endStr =
      typeof quietEnd === "string" && quietEnd.trim() ? quietEnd.trim() : null;
    const tzStr =
      typeof timeZone === "string" && timeZone.trim()
        ? timeZone.trim()
        : process.env.APP_TIME_ZONE || "Asia/Manila";

    const { client, userId } = await requireAuthenticatedSupabase();
    await updateQuietHours(client, userId, {
      quietStart: startStr,
      quietEnd: endStr,
      timeZone: tzStr,
      dailyDigest: typeof dailyDigest === "boolean" ? dailyDigest : false,
    });

    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function registerPushSubscriptionAction(input: {
  endpoint: unknown;
  keys: { p256dh: unknown; auth: unknown };
  expirationTime?: unknown;
}): Promise<NotificationActionResult> {
  try {
    const endpoint = requireText(input?.endpoint, "Push endpoint", 2000);
    const p256dh = requireText(input?.keys?.p256dh, "Push key p256dh", 500);
    const auth = requireText(input?.keys?.auth, "Push key auth", 500);
    const validationError = validateWebPushSubscription({
      endpoint,
      p256dh,
      auth,
    });
    if (validationError) {
      throw new InvalidNotificationInput("Invalid browser push subscription.");
    }

    const expirationTime =
      typeof input.expirationTime === "number" &&
      Number.isFinite(input.expirationTime) &&
      input.expirationTime > Date.now()
        ? new Date(input.expirationTime).toISOString()
        : null;

    const { client, userId } = await requireAuthenticatedSupabase();

    const device = await client
      .from("devices")
      .insert({
        user_id: userId,
        name: "Web device",
        user_agent: "Forward Web Client",
      })
      .select("id")
      .single();

    if (device.error) throw device.error;

    const saved = await client.from("push_subscriptions").upsert(
      {
        user_id: userId,
        device_id: device.data.id,
        endpoint,
        p256dh,
        auth,
        expires_at: expirationTime,
        disabled_at: null,
      },
      { onConflict: "user_id,endpoint" },
    );

    if (saved.error) throw saved.error;

    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function disablePushSubscriptionAction(
  endpoint: unknown,
): Promise<NotificationActionResult> {
  try {
    const validEndpoint = requireText(endpoint, "Push endpoint", 2000);
    const { client, userId } = await requireAuthenticatedSupabase();

    const { error } = await client
      .from("push_subscriptions")
      .update({ disabled_at: new Date().toISOString() })
      .eq("endpoint", validEndpoint)
      .eq("user_id", userId);

    if (error) throw error;

    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Generates an immediate test notification and dispatches Web Push for active user devices.
 */
export async function sendTestNotificationAction(): Promise<
  NotificationActionResult<{ delivered: boolean; message: string }>
> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    // A database-backed minute bucket keeps repeated clicks/replays idempotent
    // across server instances without adding a separate rate-limit service.
    const testKey = `test_notification:${Math.floor(Date.now() / 60_000)}`;

    const eventResult = await createNotificationEvent(client, {
      userId,
      eventType: "due_reminder",
      dedupeKey: testKey,
      title: "Test Notification",
      body: "Web Push is configured and working on this device.",
      deepLink: "/settings/notifications",
    });

    if (!eventResult.created && eventResult.suppressedReason) {
      return {
        ok: true,
        data: {
          delivered: false,
          message: `Test notification suppressed: ${eventResult.suppressedReason}`,
        },
      };
    }

    // Run dispatcher to immediately send the pending push delivery
    const { evaluateAndDispatchNotifications } = await import(
      "@/services/notifications/notification-dispatcher"
    );
    const summary = await evaluateAndDispatchNotifications(client, userId);
    refresh();

    if (summary.pushesSent > 0) {
      return {
        ok: true,
        data: {
          delivered: true,
          message: "Test push notification sent successfully.",
        },
      };
    }

    if (summary.pushesDeferred > 0) {
      return {
        ok: true,
        data: {
          delivered: false,
          message:
            "Test notification created in-app, but push was deferred because Quiet Hours are currently active.",
        },
      };
    }

    return {
      ok: true,
      data: {
        delivered: false,
        message:
          "Test notification created in-app. No active push subscriptions found on server.",
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Manually executes notification evaluation and push dispatch.
 */
export async function runNotificationDispatchAction(): Promise<
  NotificationActionResult<Record<string, unknown>>
> {
  try {
    const { client, userId } = await requireAuthenticatedSupabase();
    const { evaluateAndDispatchNotifications } = await import(
      "@/services/notifications/notification-dispatcher"
    );
    const summary = await evaluateAndDispatchNotifications(client, userId);
    refresh();
    return { ok: true, data: summary as unknown as Record<string, unknown> };
  } catch (error) {
    return failure(error);
  }
}
