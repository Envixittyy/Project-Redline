import { describe, expect, it } from "vitest";

import {
  formatNotificationTimestamp,
  getNotificationDomain,
  getNotificationDomainLabel,
  groupNotificationsByDate,
  isQuietHours,
  notificationDedupeKey,
  planCalendarEventNotification,
  planSchoolClassNotification,
  planTaskDueNotification,
  safeNotificationPayload,
} from "./notification-domain";
import type { Task } from "@/types/task";
import type { CalendarEvent } from "@/types/calendar-event";
import type { Course, PersistedCourseMeeting } from "@/types/course";
import type { NotificationEvent } from "@/types/notification";

describe("Notification Domain & Planning Engine (Phase 4C)", () => {
  const timeZone = "Asia/Manila";

  describe("Domain mapping & labels", () => {
    it("maps event types to correct domains", () => {
      expect(getNotificationDomain("blackboard_assignment")).toBe("blackboard");
      expect(getNotificationDomain("blackboard_deadline_changed")).toBe("blackboard");
      expect(getNotificationDomain("blackboard_proposal_divergence")).toBe("blackboard");
      expect(getNotificationDomain("task_due_soon")).toBe("tasks");
      expect(getNotificationDomain("task_overdue")).toBe("tasks");
      expect(getNotificationDomain("due_reminder")).toBe("tasks");
      expect(getNotificationDomain("calendar_event_soon")).toBe("calendar");
      expect(getNotificationDomain("school_class_soon")).toBe("school");
      expect(getNotificationDomain("sync_failure")).toBe("system");
      expect(getNotificationDomain("unknown_event")).toBe("system");
    });

    it("returns human-readable domain labels", () => {
      expect(getNotificationDomainLabel("tasks")).toBe("Task");
      expect(getNotificationDomainLabel("calendar")).toBe("Calendar");
      expect(getNotificationDomainLabel("school")).toBe("School");
      expect(getNotificationDomainLabel("blackboard")).toBe("Blackboard");
      expect(getNotificationDomainLabel("system")).toBe("System");
    });
  });

  describe("Task Reminder Planning (planTaskDueNotification)", () => {
    const baseTask: Task = {
      id: "task-1",
      title: "Algorithms Problem Set",
      description: null,
      status: "todo",
      priority: "high",
      dueDate: "2026-08-30",
      dueAt: null,
      scheduledStart: null,
      scheduledEnd: null,
      area: null,
      project: null,
      course: "CS201",
      courseId: "course-123",
      parentTaskId: null,
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z",
      completedAt: null,
    };

    it("suppresses reminders for completed tasks", () => {
      const completedTask: Task = {
        ...baseTask,
        status: "completed",
        completedAt: "2026-08-29T12:00:00Z",
      };
      const result = planTaskDueNotification({
        task: completedTask,
        currentInstant: new Date("2026-08-30T10:00:00Z"),
        timeZone,
      });
      expect(result).toBeNull();
    });

    it("suppresses reminders for submitted tasks", () => {
      const submittedTask: Task = {
        ...baseTask,
        status: "submitted",
      };
      const result = planTaskDueNotification({
        task: submittedTask,
        currentInstant: new Date("2026-08-30T10:00:00Z"),
        timeZone,
      });
      expect(result).toBeNull();
    });

    it("suppresses reminders for cancelled tasks", () => {
      const cancelledTask: Task = {
        ...baseTask,
        status: "cancelled",
      };
      const result = planTaskDueNotification({
        task: cancelledTask,
        currentInstant: new Date("2026-08-30T10:00:00Z"),
        timeZone,
      });
      expect(result).toBeNull();
    });

    it("plans task_due_soon for tasks due today by calendar date", () => {
      const result = planTaskDueNotification({
        task: { ...baseTask, dueDate: "2026-08-30", dueAt: null },
        currentInstant: new Date("2026-08-30T04:00:00Z"), // Manila 12:00 PM on 2026-08-30
        timeZone,
      });

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe("task_due_soon");
      expect(result?.title).toBe("Task due today");
      expect(result?.body).toContain("CS201 — Algorithms Problem Set is due today.");
      expect(result?.dedupeKey).toBe("task_due_soon:task-1:2026-08-30");
      expect(result?.deepLink).toBe("/tasks?view=today");
      expect(result?.courseId).toBe("course-123");
    });

    it("plans task_overdue for tasks whose due date has passed", () => {
      const result = planTaskDueNotification({
        task: { ...baseTask, dueDate: "2026-08-28", dueAt: null },
        currentInstant: new Date("2026-08-30T04:00:00Z"),
        timeZone,
      });

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe("task_overdue");
      expect(result?.title).toBe("Task overdue");
      expect(result?.body).toContain("was due on 2026-08-28.");
      expect(result?.deepLink).toBe("/tasks?view=overdue");
    });

    it("plans task_due_soon for tasks with exact dueAt within reminder window", () => {
      const result = planTaskDueNotification({
        task: {
          ...baseTask,
          dueAt: "2026-08-30T16:00:00Z",
          dueDate: "2026-08-30",
        },
        currentInstant: new Date("2026-08-30T08:00:00Z"),
        timeZone,
        reminderWindowHours: 24,
      });

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe("task_due_soon");
      expect(result?.title).toBe("Task due soon");
      expect(result?.dedupeKey).toBe("task_due_soon:task-1:2026-08-30T16:00:00Z");
    });

    it("plans task_overdue when dueAt instant has passed", () => {
      const result = planTaskDueNotification({
        task: {
          ...baseTask,
          dueAt: "2026-08-30T02:00:00Z",
        },
        currentInstant: new Date("2026-08-30T08:00:00Z"),
        timeZone,
      });

      expect(result).not.toBeNull();
      expect(result?.eventType).toBe("task_overdue");
      expect(result?.title).toBe("Task overdue");
      expect(result?.dedupeKey).toBe("task_overdue:task-1:2026-08-30T02:00:00Z");
    });
  });

  describe("Calendar & School Planning", () => {
    it("plans calendar_event_soon with startsAt time", () => {
      const sampleEvent: CalendarEvent = {
        id: "cal-event-1",
        title: "Team Sync",
        description: null,
        start: "2026-08-30T06:00:00Z",
        end: "2026-08-30T07:00:00Z",
        allDay: false,
        eventType: "meeting",
        source: "life_os",
        externalId: null,
        sourceUrl: null,
        course: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      };

      const planned = planCalendarEventNotification({
        event: sampleEvent,
        startsAt: sampleEvent.start,
        timeZone,
      });

      expect(planned.eventType).toBe("calendar_event_soon");
      expect(planned.title).toBe("Upcoming event");
      expect(planned.body).toContain("Team Sync starts at");
      expect(planned.deepLink).toBe("/calendar");
      expect(planned.dedupeKey).toBe("calendar_event_soon:cal-event-1:2026-08-30T06:00:00Z");
    });

    it("plans school_class_soon with course and meeting location", () => {
      const sampleCourse: Course = {
        id: "course-uuid-42",
        name: "Physics Lab",
        code: "PHY104",
        color: "#3b82f6",
        instructor: "Dr. Smith",
        location: "NW401",
        archivedAt: null,
      };

      const sampleMeeting: PersistedCourseMeeting = {
        id: "meeting-1",
        courseId: sampleCourse.id,
        title: "Lab Session",
        weekdays: [1],
        startDate: "2026-08-01",
        endDateExclusive: null,
        startTime: "10:00",
        endTime: "12:00",
        timeZone: "Asia/Manila",
        location: "NW401",
      };

      const planned = planSchoolClassNotification({
        course: sampleCourse,
        meeting: sampleMeeting,
        occurrenceInstant: "2026-08-31T02:00:00Z",
        timeZone,
      });

      expect(planned.eventType).toBe("school_class_soon");
      expect(planned.title).toBe("Upcoming class");
      expect(planned.body).toContain("PHY104 class starts at");
      expect(planned.body).toContain("in NW401");
      expect(planned.deepLink).toBe("/school");
      expect(planned.courseId).toBe("course-uuid-42");
    });
  });

  describe("Formatting & Grouping", () => {
    it("formats relative timestamps accurately", () => {
      const now = new Date("2026-08-30T12:00:00Z");

      // 30 seconds ago
      expect(
        formatNotificationTimestamp("2026-08-30T11:59:30Z", timeZone, now),
      ).toBe("Just now");

      // 10 minutes ago
      expect(
        formatNotificationTimestamp("2026-08-30T11:50:00Z", timeZone, now),
      ).toBe("10m ago");

      // 3 hours ago
      expect(
        formatNotificationTimestamp("2026-08-30T09:00:00Z", timeZone, now),
      ).toBe("3h ago");
    });

    it("groups notifications into today, yesterday, earlier", () => {
      const now = new Date("2026-08-30T12:00:00Z"); // 2026-08-30 in Manila

      const notifs: NotificationEvent[] = [
        {
          id: "n1",
          userId: "u1",
          eventType: "blackboard_assignment",
          dedupeKey: "k1",
          title: "Today Notif",
          body: "Desc",
          deepLink: "/inbox",
          courseId: null,
          readAt: null,
          createdAt: "2026-08-30T04:00:00Z",
        },
        {
          id: "n2",
          userId: "u1",
          eventType: "task_due_soon",
          dedupeKey: "k2",
          title: "Yesterday Notif",
          body: "Desc",
          deepLink: "/tasks",
          courseId: null,
          readAt: null,
          createdAt: "2026-08-29T10:00:00Z",
        },
        {
          id: "n3",
          userId: "u1",
          eventType: "calendar_event_soon",
          dedupeKey: "k3",
          title: "Earlier Notif",
          body: "Desc",
          deepLink: "/calendar",
          courseId: null,
          readAt: null,
          createdAt: "2026-08-25T10:00:00Z",
        },
      ];

      const grouped = groupNotificationsByDate(notifs, timeZone, now);
      expect(grouped.today).toHaveLength(1);
      expect(grouped.today[0].id).toBe("n1");
      expect(grouped.yesterday).toHaveLength(1);
      expect(grouped.yesterday[0].id).toBe("n2");
      expect(grouped.earlier).toHaveLength(1);
      expect(grouped.earlier[0].id).toBe("n3");
    });
  });

  describe("Security, Dedupe & Quiet Hours", () => {
    it("sanitizes external links and strips URLs in payloads", () => {
      const payload = safeNotificationPayload({
        title: "Malicious <script>alert(1)</script>",
        body: "Check out this link: https://evil.com/phishing to verify",
        deepLink: "https://evil.com/malicious",
        dedupeKey: "k-1",
      });

      expect(payload.url).toBe("/");
      expect(payload.body).not.toContain("https://evil.com");
      expect(payload.body).toContain("[link removed]");
    });

    it("evaluates quiet hours across overnight bounds", () => {
      expect(
        isQuietHours(new Date("2026-08-30T15:00:00Z"), "Asia/Manila", "22:00", "07:00"),
      ).toBe(true);

      expect(
        isQuietHours(new Date("2026-08-30T06:00:00Z"), "Asia/Manila", "22:00", "07:00"),
      ).toBe(false);
    });

    it("generates deterministic deduplication keys", () => {
      const key1 = notificationDedupeKey("task_due_soon", "task-99", "2026-08-30");
      const key2 = notificationDedupeKey("task_due_soon", "task-99", "2026-08-30");
      expect(key1).toBe(key2);
      expect(key1).toBe("task_due_soon:task-99:2026-08-30");
    });
  });
});
