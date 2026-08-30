import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
  type AuthenticatedClient,
} from "./notification-repository";

function createMockClient(options: {
  preferences?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  count?: number;
  insertEventResult?: { id: string } | null;
  subscriptions?: Array<Record<string, unknown>>;
}) {
  const preferencesData = options.preferences ?? [];
  const eventsData = options.events ?? [];
  const countVal = options.count ?? 0;
  const insertEventResult =
    options.insertEventResult !== undefined
      ? options.insertEventResult
      : { id: "new-event-id" };
  const subscriptionsData = options.subscriptions ?? [];

  const mockFrom = vi.fn((table: string) => {
    if (table === "notification_preferences") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            or: vi.fn(() => Promise.resolve({ data: preferencesData, error: null })),
            is: vi.fn(() => Promise.resolve({ data: preferencesData, error: null })),
            then: (resolve: (v: unknown) => unknown) =>
              resolve({ data: preferencesData, error: null }),
          })),
        })),
        upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
    }

    if (table === "notification_events") {
      return {
        select: vi.fn((_fields?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count === "exact") {
            return {
              eq: vi.fn(() => ({
                is: vi.fn(() => Promise.resolve({ count: countVal, error: null })),
              })),
            };
          }
          return {
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: eventsData, error: null })),
              })),
              is: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: eventsData, error: null })),
                })),
              })),
            })),
          };
        }),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({ data: insertEventResult, error: null }),
            ),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
            is: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      };
    }

    if (table === "notification_deliveries") {
      return {
        insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
    }

    if (table === "push_subscriptions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => Promise.resolve({ data: subscriptionsData, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      };
    }

    return {} as unknown;
  });

  return { from: mockFrom } as unknown as AuthenticatedClient;
}

describe("Notification Repository (Phase 4C)", () => {
  const userId = "user-uuid-1";

  describe("listNotifications & unread count", () => {
    it("reads recent notifications correctly", async () => {
      const mockRows = [
        {
          id: "event-1",
          user_id: userId,
          event_type: "task_due_soon",
          dedupe_key: "task_due_soon:1",
          title: "Math homework",
          body: "Due today",
          deep_link: "/tasks",
          course_id: null,
          read_at: null,
          created_at: "2026-08-30T10:00:00Z",
        },
      ];

      const client = createMockClient({ events: mockRows });
      const items = await listNotifications(client, userId, { limit: 10 });

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        id: "event-1",
        userId,
        eventType: "task_due_soon",
        dedupeKey: "task_due_soon:1",
        title: "Math homework",
        body: "Due today",
        deepLink: "/tasks",
        courseId: null,
        readAt: null,
        createdAt: "2026-08-30T10:00:00Z",
      });
    });

    it("gets unread notification count via exact head count query", async () => {
      const client = createMockClient({ count: 5 });
      const count = await getUnreadNotificationCount(client, userId);
      expect(count).toBe(5);
    });
  });

  describe("createNotificationEvent", () => {
    it("creates notification event and deliveries when preferences permit", async () => {
      const client = createMockClient({
        preferences: [
          {
            id: "pref-1",
            user_id: userId,
            course_id: null,
            notification_type: "tasks",
            enabled: true,
            quiet_start: null,
            quiet_end: null,
            time_zone: "Asia/Manila",
            daily_digest: false,
          },
        ],
        insertEventResult: { id: "created-event-123" },
      });

      const res = await createNotificationEvent(client, {
        userId,
        eventType: "task_due_soon",
        dedupeKey: "task_due_soon:task-1:2026-08-30",
        title: "Task due soon",
        body: "Algorithms HW is due",
        deepLink: "/tasks",
      });

      expect(res.created).toBe(true);
      expect(res.eventId).toBe("created-event-123");
      expect(res.suppressedReason).toBeNull();
    });

    it("suppresses notification when category is disabled by user preference", async () => {
      const client = createMockClient({
        preferences: [
          {
            id: "pref-1",
            user_id: userId,
            course_id: null,
            notification_type: "task_reminders",
            enabled: false, // Disabled
            quiet_start: null,
            quiet_end: null,
            time_zone: "Asia/Manila",
            daily_digest: false,
          },
        ],
      });

      const res = await createNotificationEvent(client, {
        userId,
        eventType: "task_due_soon",
        dedupeKey: "task_due_soon:task-1:2026-08-30",
        title: "Task due soon",
        body: "Algorithms HW is due",
        deepLink: "/tasks",
      });

      expect(res.created).toBe(false);
      expect(res.suppressedReason).toBe("disabled_by_preference");
    });

    it("course-specific preference override takes precedence over global preference", async () => {
      const client = createMockClient({
        preferences: [
          // Global is enabled
          {
            id: "pref-global",
            user_id: userId,
            course_id: null,
            notification_type: "blackboard_new_items",
            enabled: true,
            quiet_start: null,
            quiet_end: null,
            time_zone: "Asia/Manila",
            daily_digest: false,
          },
          // Course-specific is disabled
          {
            id: "pref-course",
            user_id: userId,
            course_id: "course-disabled-id",
            notification_type: "blackboard_assignment",
            enabled: false,
            quiet_start: null,
            quiet_end: null,
            time_zone: "Asia/Manila",
            daily_digest: false,
          },
        ],
      });

      const res = await createNotificationEvent(client, {
        userId,
        eventType: "blackboard_assignment",
        dedupeKey: "blackboard_assignment:record-1:rev-1",
        title: "New assignment",
        body: "Assignment 1 is ready",
        deepLink: "/inbox",
        courseId: "course-disabled-id",
      });

      expect(res.created).toBe(false);
      expect(res.suppressedReason).toBe("disabled_by_preference");
    });

    it("returns duplicate suppression reason when upsert yields no row (already exists)", async () => {
      const client = createMockClient({
        preferences: [],
        insertEventResult: null, // Database ignored duplicate
      });

      const res = await createNotificationEvent(client, {
        userId,
        eventType: "calendar_event_soon",
        dedupeKey: "calendar_event_soon:evt-1:2026-08-30",
        title: "Meeting",
        body: "Meeting soon",
        deepLink: "/calendar",
      });

      expect(res.created).toBe(false);
      expect(res.suppressedReason).toBe("duplicate");
    });
  });

  describe("Mark read, mark unread, mark all read, delete", () => {
    it("calls markNotificationRead successfully", async () => {
      const client = createMockClient({});
      await expect(
        markNotificationRead(client, userId, "event-123"),
      ).resolves.toBeUndefined();
    });

    it("calls markNotificationUnread successfully", async () => {
      const client = createMockClient({});
      await expect(
        markNotificationUnread(client, userId, "event-123"),
      ).resolves.toBeUndefined();
    });

    it("calls markAllNotificationsRead successfully", async () => {
      const client = createMockClient({});
      await expect(
        markAllNotificationsRead(client, userId),
      ).resolves.toBeUndefined();
    });

    it("calls deleteNotificationEvent successfully", async () => {
      const client = createMockClient({});
      await expect(
        deleteNotificationEvent(client, userId, "event-123"),
      ).resolves.toBeUndefined();
    });
  });

  describe("Preferences & Quiet Hours CRUD", () => {
    it("parses user notification preferences accurately", async () => {
      const client = createMockClient({
        preferences: [
          {
            id: "p1",
            user_id: userId,
            course_id: null,
            notification_type: "task_reminders",
            enabled: false,
            quiet_start: "22:00",
            quiet_end: "07:00",
            time_zone: "Asia/Manila",
            daily_digest: true,
          },
          {
            id: "p2",
            user_id: userId,
            course_id: null,
            notification_type: "calendar_reminders",
            enabled: true,
            quiet_start: null,
            quiet_end: null,
            time_zone: "Asia/Manila",
            daily_digest: false,
          },
        ],
      });

      const prefs = await getNotificationPreferences(client, userId);
      expect(prefs.taskReminders).toBe(false);
      expect(prefs.calendarReminders).toBe(true);
      expect(prefs.schoolClassReminders).toBe(true); // default true
      expect(prefs.blackboardNewItems).toBe(true); // default true
      expect(prefs.quietHoursStart).toBe("22:00");
      expect(prefs.quietHoursEnd).toBe("07:00");
      expect(prefs.timeZone).toBe("Asia/Manila");
      expect(prefs.dailyDigest).toBe(true);
    });

    it("updates category preference via updateNotificationPreference", async () => {
      const client = createMockClient({});
      await expect(
        updateNotificationPreference(client, userId, {
          notificationType: "school_class_reminders",
          enabled: false,
        }),
      ).resolves.toBeUndefined();
    });

    it("updates quiet hours via updateQuietHours", async () => {
      const client = createMockClient({});
      await expect(
        updateQuietHours(client, userId, {
          quietStart: "23:00",
          quietEnd: "06:00",
          timeZone: "Asia/Manila",
          dailyDigest: false,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
