import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  let mockExternalRecords: Array<Record<string, unknown>> = [];
  let mockCaptureProposals: Array<Record<string, unknown>> = [];
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
                eq: vi.fn((_field: string, taskId: string) => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data: mockTasks.find((task) => task.id === taskId) ?? null,
                      error: null,
                    }),
                  ),
                })),
              })),
            })),
          };
        }

        if (table === "calendar_events") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn((_field: string, value: string | boolean) => ({
                  gte: vi.fn((_f1: string, startVal: string) => ({
                    lte: vi.fn((_f2: string, endVal: string) => {
                      const matching = mockCalendarEvents.filter((e) => {
                        const start = e.starts_at as string;
                        return start >= startVal && start <= endVal;
                      });
                      return Promise.resolve({ data: matching, error: null });
                    }),
                  })),
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data:
                        mockCalendarEvents.find((event) => event.id === value) ??
                        null,
                      error: null,
                    }),
                  ),
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
                eq: vi.fn((_field: string, courseId: string) => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data: mockCourses.find((course) => course.id === courseId) ?? null,
                      error: null,
                    }),
                  ),
                })),
              })),
            })),
          };
        }

        if (table === "course_meetings") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => {
                const result = Promise.resolve({
                  data: mockCourseMeetings,
                  error: null,
                }) as Promise<{
                  data: Array<Record<string, unknown>>;
                  error: null;
                }> & {
                  eq: (field: string, meetingId: string) => {
                    maybeSingle: () => Promise<{
                      data: Record<string, unknown> | null;
                      error: null;
                    }>;
                  };
                };
                result.eq = (_field: string, meetingId: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data:
                        mockCourseMeetings.find(
                          (meeting) => meeting.id === meetingId,
                        ) ?? null,
                      error: null,
                    }),
                });
                return result;
              }),
            })),
          };
        }

        if (table === "external_records" || table === "capture_proposals") {
          const rows =
            table === "external_records"
              ? mockExternalRecords
              : mockCaptureProposals;
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn((_field: string, sourceId: string) => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data:
                        rows.find((row) =>
                          table === "external_records"
                            ? row.id === sourceId
                            : row.external_record_id === sourceId,
                        ) ?? null,
                      error: null,
                    }),
                  ),
                })),
              })),
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
            update: vi.fn((fields: Record<string, unknown>) => {
              const filters: Array<[string, unknown]> = [];
              const execute = () => {
                const matches = (delivery: Record<string, unknown>) =>
                  filters.every(([field, value]) => delivery[field] === value);
                const matched = mockDeliveries.find(matches);
                mockDeliveries = mockDeliveries.map((delivery) =>
                  matches(delivery) ? { ...delivery, ...fields } : delivery,
                );
                return matched
                  ? { data: { id: matched.id }, error: null }
                  : { data: null, error: null };
              };
              const chain = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return chain;
                },
                lt() {
                  return Promise.resolve({ data: null, error: null });
                },
                select() {
                  return chain;
                },
                maybeSingle() {
                  return Promise.resolve(execute());
                },
                then(resolve: (value: unknown) => unknown) {
                  return Promise.resolve(execute()).then(resolve);
                },
              };
              return chain;
            }),
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

  afterEach(() => vi.useRealTimers());

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
    mockExternalRecords = [];
    mockCaptureProposals = [];
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
    for (const [, requestInit] of mockFetch.mock.calls as Array<
      [string, RequestInit]
    >) {
      const topic = (requestInit.headers as Record<string, string>).Topic;
      expect(topic).toMatch(/^event-[A-Za-z0-9_-]{24}$/);
      expect(topic).not.toContain("task-101");
      expect(topic).not.toContain("event-201");
      expect(topic).not.toContain("meeting-1");
    }
  });

  it("defers push deliveries during quiet hours while still generating in-app events", async () => {
    const client = createMockSupabaseClient();
    // Force a different wall clock: delivery creation must use the supplied instant.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T04:00:00Z"));
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
    // Creation already marks these deliveries deferred; this counter tracks
    // only pending deliveries newly deferred by the dispatcher.
    expect(summary.pushesDeferred).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    const webPushDeliveries = mockDeliveries.filter((d) => d.channel === "web_push");
    expect(webPushDeliveries).toHaveLength(1);
    expect(webPushDeliveries.every((d) => d.status === "deferred")).toBe(true);
    expect(mockDeliveries.find((d) => d.channel === "in_app")?.delivered_at).toBe(currentInstant.toISOString());
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

  it("atomically claims a pending delivery across concurrent dispatcher runs", async () => {
    mockCalendarEvents = [];
    mockCourses = [];
    mockCourseMeetings = [];
    mockNotificationEvents.push({
      id: "event-concurrent",
      user_id: userId,
      event_type: "task_due_soon",
      dedupe_key: "task_due_soon:task-101:2026-08-30",
      title: "Calculus",
      body: "Due today",
      deep_link: "/tasks",
      course_id: "course-1",
      created_at: "2026-08-30T03:59:00Z",
    });
    mockDeliveries.push({
      id: "delivery-concurrent",
      user_id: userId,
      notification_event_id: "event-concurrent",
      push_subscription_id: "sub-1",
      channel: "web_push",
      status: "pending",
      created_at: "2026-08-30T03:59:00Z",
    });

    const client = createMockSupabaseClient();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const currentInstant = new Date("2026-08-30T04:00:00Z");

    const summaries = await Promise.all([
      evaluateAndDispatchNotifications(client, userId, {
        currentInstant,
        fetchImpl,
      }),
      evaluateAndDispatchNotifications(client, userId, {
        currentInstant,
        fetchImpl,
      }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(summaries.reduce((total, summary) => total + summary.pushesSent, 0)).toBe(1);
    expect(
      mockDeliveries.find((delivery) => delivery.id === "delivery-concurrent")
        ?.status,
    ).toBe("sent");
  });

  it("suppresses a deferred reminder after its task is completed", async () => {
    mockCalendarEvents = [];
    mockCourses = [];
    mockCourseMeetings = [];
    mockTasks[0].status = "completed";
    mockNotificationEvents.push({
      id: "event-completed",
      user_id: userId,
      event_type: "task_due_soon",
      dedupe_key: "task_due_soon:task-101:2026-08-30",
      title: "Calculus",
      body: "Due today",
      deep_link: "/tasks",
      course_id: "course-1",
      created_at: "2026-08-30T03:00:00Z",
    });
    mockDeliveries.push({
      id: "delivery-completed",
      user_id: userId,
      notification_event_id: "event-completed",
      push_subscription_id: "sub-1",
      channel: "web_push",
      status: "deferred",
      created_at: "2026-08-30T03:00:00Z",
    });

    const fetchImpl = vi.fn();
    await evaluateAndDispatchNotifications(createMockSupabaseClient(), userId, {
      currentInstant: new Date("2026-08-30T04:00:00Z"),
      fetchImpl,
    });

    const delivery = mockDeliveries.find(
      (candidate) => candidate.id === "delivery-completed",
    );
    expect(delivery?.status).toBe("unavailable");
    expect(delivery?.error_code).toBe("source_changed_or_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("suppresses a deferred reminder after its preference is disabled", async () => {
    mockCalendarEvents = [];
    mockCourses = [];
    mockCourseMeetings = [];
    mockPreferences[0].enabled = false;
    mockNotificationEvents.push({
      id: "event-disabled",
      user_id: userId,
      event_type: "task_due_soon",
      dedupe_key: "task_due_soon:task-101:2026-08-30",
      title: "Calculus",
      body: "Due today",
      deep_link: "/tasks",
      course_id: "course-1",
      created_at: "2026-08-30T03:00:00Z",
    });
    mockDeliveries.push({
      id: "delivery-disabled",
      user_id: userId,
      notification_event_id: "event-disabled",
      push_subscription_id: "sub-1",
      channel: "web_push",
      status: "deferred",
      created_at: "2026-08-30T03:00:00Z",
    });

    const fetchImpl = vi.fn();
    await evaluateAndDispatchNotifications(createMockSupabaseClient(), userId, {
      currentInstant: new Date("2026-08-30T04:00:00Z"),
      fetchImpl,
    });

    const delivery = mockDeliveries.find(
      (candidate) => candidate.id === "delivery-disabled",
    );
    expect(delivery?.status).toBe("unavailable");
    expect(delivery?.error_code).toBe("disabled_by_preference");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors a course override when the global task preference is disabled", async () => {
    mockCalendarEvents = [];
    mockCourses = [];
    mockCourseMeetings = [];
    mockPreferences[0].notification_type = "task_reminders";
    mockPreferences[0].enabled = false;
    mockPreferences.push({
      id: "p-course",
      user_id: userId,
      course_id: "course-1",
      notification_type: "task_reminders",
      enabled: true,
      quiet_start: null,
      quiet_end: null,
      time_zone: timeZone,
      daily_digest: false,
    });

    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const summary = await evaluateAndDispatchNotifications(
      createMockSupabaseClient(),
      userId,
      {
        currentInstant: new Date("2026-08-30T04:00:00Z"),
        fetchImpl,
      },
    );

    expect(summary.taskNotificationsPlanned).toBe(1);
    expect(summary.pushesSent).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("suppresses a deferred Blackboard notification after dismissal", async () => {
    mockTasks = [];
    mockCalendarEvents = [];
    mockCourses = [];
    mockCourseMeetings = [];
    mockExternalRecords.push({
      id: "record-1",
      proposal_revision: "revision-1",
      missing_since: null,
    });
    mockCaptureProposals.push({
      external_record_id: "record-1",
      status: "rejected",
      source_revision: "revision-1",
    });
    mockNotificationEvents.push({
      id: "event-blackboard-dismissed",
      user_id: userId,
      event_type: "blackboard_assignment",
      dedupe_key: "blackboard_assignment:record-1:revision-1",
      title: "New Blackboard item",
      body: "An item is available for review.",
      deep_link: "/inbox",
      course_id: null,
      created_at: "2026-08-30T03:00:00Z",
    });
    mockDeliveries.push({
      id: "delivery-blackboard-dismissed",
      user_id: userId,
      notification_event_id: "event-blackboard-dismissed",
      push_subscription_id: "sub-1",
      channel: "web_push",
      status: "deferred",
      created_at: "2026-08-30T03:00:00Z",
    });

    const fetchImpl = vi.fn();
    await evaluateAndDispatchNotifications(createMockSupabaseClient(), userId, {
      currentInstant: new Date("2026-08-30T04:00:00Z"),
      fetchImpl,
    });

    const delivery = mockDeliveries.find(
      (candidate) => candidate.id === "delivery-blackboard-dismissed",
    );
    expect(delivery?.status).toBe("unavailable");
    expect(delivery?.error_code).toBe("source_changed_or_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
