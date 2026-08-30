import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateAndDispatchNotifications } from "./notification-dispatcher";
import type { AuthenticatedClient } from "./notification-repository";

describe("Notification Dispatcher Engine (Phase 4D)", () => {
  const userId = "user-test-uuid";
  const timeZone = "Asia/Manila";

  // Generate valid P-256 test VAPID keys
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const testVapidPublicKey = ecdh.getPublicKey("base64url");
  const testVapidPrivateKey = ecdh.getPrivateKey("base64url");

  // Generate valid client receiver keys
  const clientEcdh = crypto.createECDH("prime256v1");
  clientEcdh.generateKeys();
  const clientP256dh = clientEcdh.getPublicKey("base64url");
  const clientAuth = crypto.randomBytes(16).toString("base64url");

  // Mock DB state
  let mockPreferences: Array<Record<string, unknown>> = [];
  let mockTasks: Array<Record<string, unknown>> = [];
  let mockCalendarEvents: Array<Record<string, unknown>> = [];
  let mockCourses: Array<Record<string, unknown>> = [];
  let mockCourseMeetings: Array<Record<string, unknown>> = [];
  let mockNotificationEvents: Array<Record<string, unknown>> = [];
  let mockDeliveries: Array<Record<string, unknown>> = [];
  let mockPushSubscriptions: Array<Record<string, unknown>> = [];

  function createMockSupabaseClient() {
    return {
      from: vi.fn((table: string) => {
        if (table === "notification_preferences") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                or: vi.fn(() => Promise.resolve({ data: mockPreferences, error: null })),
                is: vi.fn(() => Promise.resolve({ data: mockPreferences, error: null })),
                then: (resolve: (v: unknown) => unknown) =>
                  resolve({ data: mockPreferences, error: null }),
              })),
            })),
            upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
          };
        }

        if (table === "tasks") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => Promise.resolve({ data: mockTasks, error: null })),
              })),
            })),
          };
        }

        if (table === "calendar_events") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn((_f1: string, startVal: string) => ({
                    lte: vi.fn((_f2: string, endVal: string) => {
                      const matching = mockCalendarEvents.filter((e) => {
                        const start = e.starts_at as string;
                        return start >= startVal && start <= endVal;
                      });
                      return Promise.resolve({ data: matching, error: null });
                    }),
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
                is: vi.fn(() => Promise.resolve({ data: mockCourses, error: null })),
              })),
            })),
          };
        }

        if (table === "course_meetings") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() =>
                Promise.resolve({ data: mockCourseMeetings, error: null }),
              ),
            })),
          };
        }

        if (table === "notification_events") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() =>
                    Promise.resolve({ data: mockNotificationEvents, error: null }),
                  ),
                })),
                is: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() =>
                      Promise.resolve({
                        data: mockNotificationEvents.filter((e) => !e.read_at),
                        error: null,
                      }),
                    ),
                  })),
                })),
              })),
            })),
            upsert: vi.fn((eventData: Record<string, unknown>) => {
              const existing = mockNotificationEvents.find(
                (e) =>
                  e.user_id === eventData.user_id &&
                  e.dedupe_key === eventData.dedupe_key,
              );
              if (existing) {
                return {
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn(() =>
                      Promise.resolve({ data: null, error: null }),
                    ),
                  })),
                };
              }
              const created = { id: `event-${Date.now()}-${Math.random()}`, ...eventData };
              mockNotificationEvents.push(created);
              return {
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({ data: created, error: null }),
                  ),
                })),
              };
            }),
          };
        }

        if (table === "notification_deliveries") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: string) => ({
                eq: vi.fn((f2: string, v2: string) => ({
                  eq: vi.fn((f3: string, statusVal: string) => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => {
                        const matching = mockDeliveries
                          .filter(
                            (d) =>
                              d.user_id === v1 &&
                              d.channel === v2 &&
                              d.status === statusVal,
                          )
                          .map((d) => {
                            const event = mockNotificationEvents.find(
                              (e) => e.id === d.notification_event_id,
                            );
                            const subscription = mockPushSubscriptions.find(
                              (s) => s.id === d.push_subscription_id,
                            );
                            return {
                              ...d,
                              notification_events: event
                                ? {
                                    id: event.id,
                                    event_type: event.event_type,
                                    dedupe_key: event.dedupe_key,
                                    title: event.title,
                                    body: event.body,
                                    deep_link: event.deep_link,
                                    course_id: event.course_id,
                                    created_at: event.created_at,
                                  }
                                : null,
                              push_subscriptions: subscription
                                ? {
                                    id: subscription.id,
                                    endpoint: subscription.endpoint,
                                    p256dh: subscription.p256dh,
                                    auth: subscription.auth,
                                    disabled_at: subscription.disabled_at,
                                  }
                                : null,
                            };
                          });
                        return Promise.resolve({ data: matching, error: null });
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(
              (
                deliveryData:
                  | Record<string, unknown>
                  | Array<Record<string, unknown>>,
              ) => {
                if (Array.isArray(deliveryData)) {
                  for (const item of deliveryData) {
                    mockDeliveries.push({
                      id: `deliv-${Date.now()}-${Math.random()}`,
                      ...item,
                    });
                  }
                } else {
                  mockDeliveries.push({
                    id: `deliv-${Date.now()}-${Math.random()}`,
                    ...deliveryData,
                  });
                }
                return Promise.resolve({ data: null, error: null });
              },
            ),
            update: vi.fn((fields: Record<string, unknown>) => ({
              eq: vi.fn((_f1: string, delivId: string) => ({
                eq: vi.fn(() => {
                  mockDeliveries = mockDeliveries.map((d) =>
                    d.id === delivId ? { ...d, ...fields } : d,
                  );
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
            })),
          };
        }

        if (table === "push_subscriptions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() =>
                  Promise.resolve({
                    data: mockPushSubscriptions.filter((s) => !s.disabled_at),
                    error: null,
                  }),
                ),
              })),
            })),
            update: vi.fn((fields: Record<string, unknown>) => ({
              eq: vi.fn((_f1: string, subId: string) => ({
                eq: vi.fn(() => {
                  mockPushSubscriptions = mockPushSubscriptions.map((s) =>
                    s.id === subId ? { ...s, ...fields } : s,
                  );
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
            })),
          };
        }

        return {} as unknown;
      }),
    } as unknown as AuthenticatedClient;
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = testVapidPublicKey;
    process.env.VAPID_PRIVATE_KEY = testVapidPrivateKey;
    process.env.VAPID_SUBJECT = "mailto:test@redline.internal";

    mockPreferences = [
      {
        id: "p1",
        user_id: userId,
        course_id: null,
        notification_type: "tasks",
        enabled: true,
        quiet_start: "22:00",
        quiet_end: "07:00",
        time_zone: timeZone,
        daily_digest: false,
      },
    ];

    mockTasks = [
      {
        id: "task-101",
        title: "Calculus Problem Set",
        description: "Exercises 1-10",
        status: "todo",
        priority: "high",
        due_date: "2026-08-30",
        due_at: null,
        scheduled_start: null,
        scheduled_end: null,
        area: null,
        project: null,
        course: "MATH101",
        course_id: "course-1",
        parent_task_id: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
        completed_at: null,
      },
    ];

    mockCalendarEvents = [
      {
        id: "event-201",
        title: "Advisor Meeting",
        description: "Discuss research thesis",
        starts_at: "2026-08-30T04:20:00Z", // Starts in 20m from 04:00:00Z
        ends_at: "2026-08-30T05:00:00Z",
        all_day: false,
        event_type: "meeting",
        source: "life_os",
        external_id: null,
        source_url: null,
        course: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
      },
    ];

    mockCourses = [
      {
        id: "course-1",
        code: "CS101",
        name: "Intro to Computer Science",
        instructor: "Dr. Turing",
        location: "Hall A",
        color: "#3b82f6",
        archived_at: null,
      },
    ];

    mockCourseMeetings = [
      {
        id: "meeting-1",
        course_id: "course-1",
        title: "Lecture",
        weekdays: [0], // Sunday (2026-08-30 is Sunday)
        start_date: "2026-08-01",
        end_date_exclusive: null,
        start_time: "12:15", // Manila time 12:15 PM = 04:15:00Z (starts in 15m from 04:00:00Z)
        end_time: "13:45",
        time_zone: timeZone,
        location: "Hall A",
      },
    ];

    mockNotificationEvents = [];
    mockDeliveries = [];
    mockPushSubscriptions = [
      {
        id: "sub-1",
        user_id: userId,
        endpoint: "https://fcm.googleapis.com/fcm/send/device-token-1",
        p256dh: clientP256dh,
        auth: clientAuth,
        disabled_at: null,
      },
    ];
  });

  it("evaluates tasks, calendar events, and school classes, creating in-app events and push deliveries", async () => {
    const client = createMockSupabaseClient();
    const currentInstant = new Date("2026-08-30T04:00:00Z"); // 12:00 PM Manila (outside quiet hours 22:00-07:00)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve(""),
    } as unknown as Response);

    const summary = await evaluateAndDispatchNotifications(client, userId, {
      currentInstant,
      fetchImpl: mockFetch,
    });

    expect(summary.tasksEvaluated).toBe(1);
    expect(summary.taskNotificationsPlanned).toBe(1);
    expect(summary.calendarEvaluated).toBe(1);
    expect(summary.calendarNotificationsPlanned).toBe(1);
    expect(summary.schoolEvaluated).toBe(1);
    expect(summary.schoolNotificationsPlanned).toBe(1);

    expect(mockNotificationEvents.length).toBe(3);
    // 3 in_app + 3 web_push = 6 deliveries
    expect(mockDeliveries.length).toBe(6);
    expect(mockDeliveries.filter((d) => d.channel === "web_push").length).toBe(3);
    expect(summary.pushesSent).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("defers push deliveries during quiet hours while still generating in-app events", async () => {
    const client = createMockSupabaseClient();
    // 23:00 Manila (15:00 UTC) is inside quiet hours 22:00 - 07:00
    const currentInstant = new Date("2026-08-30T15:00:00Z");

    const mockFetch = vi.fn();

    const summary = await evaluateAndDispatchNotifications(client, userId, {
      currentInstant,
      fetchImpl: mockFetch,
    });

    // In-app notifications are still created for task due today
    expect(summary.taskNotificationsPlanned).toBe(1);
    expect(mockNotificationEvents.length).toBe(1);

    // Push deliveries are deferred, not sent
    expect(summary.pushesSent).toBe(0);
    expect(summary.pushesDeferred).toBeGreaterThanOrEqual(1);
    expect(mockFetch).not.toHaveBeenCalled();

    const webPushDeliveries = mockDeliveries.filter((d) => d.channel === "web_push");
    expect(webPushDeliveries.every((d) => d.status === "deferred")).toBe(true);
  });

  it("reconciles deferred deliveries when quiet hours end, sending fresh and expiring stale ones", async () => {
    const client = createMockSupabaseClient();

    // Add an existing deferred task notification (fresh, 2 hours old)
    const freshEventId = "event-fresh";
    mockNotificationEvents.push({
      id: freshEventId,
      user_id: userId,
      event_type: "task_due_soon",
      dedupe_key: "task_due_soon:task-101:2026-08-30",
      title: "Calculus",
      body: "Due today",
      deep_link: "/tasks",
      course_id: "course-1",
      read_at: null,
      created_at: "2026-08-30T06:00:00Z",
    });
    mockDeliveries.push({
      id: "deliv-fresh",
      user_id: userId,
      notification_event_id: freshEventId,
      push_subscription_id: "sub-1",
      channel: "web_push",
      status: "deferred",
      created_at: "2026-08-30T06:00:00Z",
    });

    // Add an existing deferred school class notification (stale: class was at 02:00:00Z, now is 08:00:00Z)
    const staleEventId = "event-stale";
    mockNotificationEvents.push({
      id: staleEventId,
      user_id: userId,
      event_type: "school_class_soon",
      dedupe_key: "school_class_soon:course-1:meeting-1:2026-08-30T02:00:00Z",
      title: "CS101 class",
      body: "Starts in 15m",
      deep_link: "/school",
      course_id: "course-1",
      read_at: null,
      created_at: "2026-08-30T01:45:00Z",
    });
    mockDeliveries.push({
      id: "deliv-stale",
      user_id: userId,
      notification_event_id: staleEventId,
      push_subscription_id: "sub-1",
      channel: "web_push",
      status: "deferred",
      created_at: "2026-08-30T01:45:00Z",
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    } as unknown as Response);

    // Current instant is 08:00:00Z (4:00 PM Manila - outside quiet hours)
    const currentInstant = new Date("2026-08-30T08:00:00Z");

    const summary = await evaluateAndDispatchNotifications(client, userId, {
      currentInstant,
      fetchImpl: mockFetch,
    });

    // Fresh deferred task is transitioned and sent
    expect(summary.deferredReconciled).toBe(1);
    // Stale deferred school class is expired
    expect(summary.deferredExpired).toBe(1);

    const staleDelivery = mockDeliveries.find((d) => d.id === "deliv-stale");
    expect(staleDelivery?.status).toBe("unavailable");
    expect(staleDelivery?.error_code).toBe("expired_during_quiet_hours");
  });

  it("disables push subscription when receiving HTTP 410 Gone", async () => {
    const client = createMockSupabaseClient();
    const currentInstant = new Date("2026-08-30T04:00:00Z");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      text: () => Promise.resolve("Gone"),
    } as unknown as Response);

    const summary = await evaluateAndDispatchNotifications(client, userId, {
      currentInstant,
      fetchImpl: mockFetch,
    });

    expect(summary.pushesFailed).toBeGreaterThanOrEqual(1);

    // Subscription should be marked disabled
    const sub = mockPushSubscriptions.find((s) => s.id === "sub-1");
    expect(sub?.disabled_at).toBeTruthy();
  });

  it("guarantees idempotency across consecutive runs with 0 duplicates", async () => {
    const client = createMockSupabaseClient();
    const currentInstant = new Date("2026-08-30T04:00:00Z");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: () => Promise.resolve(""),
    } as unknown as Response);

    // Run 1
    const run1 = await evaluateAndDispatchNotifications(client, userId, {
      currentInstant,
      fetchImpl: mockFetch,
    });
    expect(run1.taskNotificationsPlanned).toBe(1);
    const eventCountAfterRun1 = mockNotificationEvents.length;

    // Run 2 immediately after
    const run2 = await evaluateAndDispatchNotifications(client, userId, {
      currentInstant,
      fetchImpl: mockFetch,
    });
    expect(run2.taskNotificationsPlanned).toBe(0);
    expect(run2.calendarNotificationsPlanned).toBe(0);
    expect(run2.schoolNotificationsPlanned).toBe(0);
    expect(run2.pushesSent).toBe(0);

    // Total events remain unchanged
    expect(mockNotificationEvents.length).toBe(eventCountAfterRun1);
  });
});
