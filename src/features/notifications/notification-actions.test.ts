import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deleteNotificationAction,
  disablePushSubscriptionAction,
  getNotificationPreferencesAction,
  getNotificationsAction,
  getUnreadCountAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  markNotificationUnreadAction,
  registerPushSubscriptionAction,
  runNotificationDispatchAction,
  saveNotificationPreferenceAction,
  saveQuietHoursAction,
  sendTestNotificationAction,
} from "./notification-actions";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockUserId = "user-test-123";

let mockNotificationRows: Array<Record<string, unknown>> = [];
let mockPrefRows: Array<Record<string, unknown>> = [];
const mockDeliveries: Array<Record<string, unknown>> = [];

vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: vi.fn(async () => ({
    userId: mockUserId,
    client: {
      from: vi.fn((table: string) => {
        if (table === "notification_events") {
          return {
            select: vi.fn((_f?: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count === "exact") {
                return {
                  eq: vi.fn(() => ({
                    is: vi.fn(() =>
                      Promise.resolve({
                        count: mockNotificationRows.filter((r) => !r.read_at).length,
                        error: null,
                      }),
                    ),
                  })),
                };
              }
              return {
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() =>
                      Promise.resolve({ data: mockNotificationRows, error: null }),
                    ),
                  })),
                  is: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() =>
                        Promise.resolve({
                          data: mockNotificationRows.filter((r) => !r.read_at),
                          error: null,
                        }),
                      ),
                    })),
                  })),
                })),
              };
            }),
            upsert: vi.fn((eventData: Record<string, unknown>) => {
              const created = { id: `event-${Date.now()}`, ...eventData };
              mockNotificationRows.push(created);
              return {
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({ data: created, error: null }),
                  ),
                })),
              };
            }),
            update: vi.fn((fields: Record<string, unknown>) => ({
              eq: vi.fn((_f1: string, idVal: string) => ({
                eq: vi.fn(() => {
                  mockNotificationRows = mockNotificationRows.map((r) =>
                    r.id === idVal ? { ...r, ...fields } : r,
                  );
                  return Promise.resolve({ data: null, error: null });
                }),
                is: vi.fn(() => {
                  mockNotificationRows = mockNotificationRows.map((r) =>
                    !r.read_at ? { ...r, ...fields } : r,
                  );
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn((_f1: string, idVal: string) => ({
                eq: vi.fn(() => {
                  mockNotificationRows = mockNotificationRows.filter(
                    (r) => r.id !== idVal,
                  );
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
            })),
          };
        }

        if (table === "notification_preferences") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                or: vi.fn(() => Promise.resolve({ data: mockPrefRows, error: null })),
                is: vi.fn(() => Promise.resolve({ data: mockPrefRows, error: null })),
                then: (resolve: (v: unknown) => unknown) =>
                  resolve({ data: mockPrefRows, error: null }),
              })),
            })),
            upsert: vi.fn((data: Record<string, unknown>) => {
              mockPrefRows.push(data);
              return Promise.resolve({ data: null, error: null });
            }),
          };
        }

        if (table === "notification_deliveries") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn((deliv: Record<string, unknown>) => {
              mockDeliveries.push(deliv);
              return Promise.resolve({ data: null, error: null });
            }),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
          };
        }

        if (table === "tasks") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          };
        }

        if (table === "calendar_events") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lte: vi.fn(() => Promise.resolve({ data: [], error: null })),
                  })),
                })),
              })),
            })),
          };
        }

        if (table === "courses") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          };
        }

        if (table === "course_meetings") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          };
        }

        if (table === "devices") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({ data: { id: "device-1" }, error: null }),
                ),
              })),
            })),
          };
        }

        if (table === "push_subscriptions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
            upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
          };
        }

        return {} as unknown;
      }),
    },
  })),
}));

describe("Notification Server Actions (Phase 4C)", () => {
  beforeEach(() => {
    mockNotificationRows = [
      {
        id: "notif-1",
        user_id: mockUserId,
        event_type: "task_due_soon",
        dedupe_key: "task_due_soon:1",
        title: "Homework due",
        body: "Math HW is due today",
        deep_link: "/tasks",
        course_id: null,
        read_at: null,
        created_at: "2026-08-30T10:00:00Z",
      },
    ];
    mockPrefRows = [
      {
        id: "p1",
        user_id: mockUserId,
        course_id: null,
        notification_type: "tasks",
        enabled: true,
        quiet_start: "22:00",
        quiet_end: "07:00",
        time_zone: "Asia/Manila",
        daily_digest: false,
      },
    ];
  });

  it("getNotificationsAction returns notifications and unread count", async () => {
    const res = await getNotificationsAction(20);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.notifications).toHaveLength(1);
      expect(res.data.unreadCount).toBe(1);
      expect(res.data.notifications[0].title).toBe("Homework due");
    }
  });

  it("getUnreadCountAction returns count directly", async () => {
    const res = await getUnreadCountAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toBe(1);
    }
  });

  it("markNotificationReadAction marks item read and validates ID", async () => {
    const invalidRes = await markNotificationReadAction("");
    expect(invalidRes.ok).toBe(false);

    const validRes = await markNotificationReadAction("notif-1");
    expect(validRes.ok).toBe(true);
    expect(mockNotificationRows[0].read_at).toBeTruthy();
  });

  it("markNotificationUnreadAction clears read timestamp", async () => {
    mockNotificationRows[0].read_at = "2026-08-30T11:00:00Z";
    const res = await markNotificationUnreadAction("notif-1");
    expect(res.ok).toBe(true);
    expect(mockNotificationRows[0].read_at).toBeNull();
  });

  it("markAllNotificationsReadAction marks all unread items as read", async () => {
    const res = await markAllNotificationsReadAction();
    expect(res.ok).toBe(true);
    expect(mockNotificationRows.every((r) => r.read_at !== null)).toBe(true);
  });

  it("deleteNotificationAction removes the event", async () => {
    const res = await deleteNotificationAction("notif-1");
    expect(res.ok).toBe(true);
    expect(mockNotificationRows).toHaveLength(0);
  });

  it("getNotificationPreferencesAction reads user preferences", async () => {
    const res = await getNotificationPreferencesAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.taskReminders).toBe(true);
      expect(res.data.quietHoursStart).toBe("22:00");
    }
  });

  it("saveNotificationPreferenceAction validates and saves toggle", async () => {
    const invalid = await saveNotificationPreferenceAction("tasks", "not-a-bool");
    expect(invalid.ok).toBe(false);

    const valid = await saveNotificationPreferenceAction("task_reminders", false);
    expect(valid.ok).toBe(true);
  });

  it("saveQuietHoursAction updates quiet hours and timezone", async () => {
    const res = await saveQuietHoursAction("23:00", "06:00", "Asia/Manila", false);
    expect(res.ok).toBe(true);
  });

  it("registerPushSubscriptionAction validates HTTPS endpoint and keys", async () => {
    const invalidEndpoint = await registerPushSubscriptionAction({
      endpoint: "http://insecure.com",
      keys: { p256dh: "key1", auth: "auth1" },
    });
    expect(invalidEndpoint.ok).toBe(false);

    const valid = await registerPushSubscriptionAction({
      endpoint: "https://fcm.googleapis.com/fcm/send/sample",
      keys: { p256dh: "key1", auth: "auth1" },
    });
    expect(valid.ok).toBe(true);
  });

  it("disablePushSubscriptionAction disables push endpoint", async () => {
    const res = await disablePushSubscriptionAction(
      "https://fcm.googleapis.com/fcm/send/sample",
    );
    expect(res.ok).toBe(true);
  });

  it("sendTestNotificationAction creates a test notification event", async () => {
    const res = await sendTestNotificationAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.message).toBeTruthy();
    }
  });

  it("runNotificationDispatchAction executes notification dispatch summary", async () => {
    const res = await runNotificationDispatchAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveProperty("tasksEvaluated");
      expect(res.data).toHaveProperty("pushesSent");
    }
  });
});
