"use client";

import {
  CalendarDays,
  GraduationCap,
  ListTodo,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Surface } from "@/components/ui/surface";
import { Toggle } from "@/components/ui/toggle";
import type { NotificationPreferencesState } from "@/types/notification";

import {
  disablePushSubscriptionAction,
  getNotificationPreferencesAction,
  registerPushSubscriptionAction,
  saveNotificationPreferenceAction,
  saveQuietHoursAction,
  sendTestNotificationAction,
} from "./notification-actions";
import styles from "./notification-preferences.module.css";

export function NotificationPreferences() {
  const [loading, setLoading] = useState(true);
  const [savingQuiet, setSavingQuiet] = useState(false);
  const [quietSaved, setQuietSaved] = useState(false);

  const [preferences, setPreferences] = useState<NotificationPreferencesState>({
    taskReminders: true,
    calendarReminders: true,
    schoolClassReminders: true,
    blackboardNewItems: true,
    blackboardDeadlineChanges: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    timeZone: "Asia/Manila",
    dailyDigest: false,
  });

  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Manila");

  // Push notification state
  const [pushStatus, setPushStatus] = useState<
    "active" | "disabled" | "blocked" | "unsupported"
  >("unsupported");
  const [pushLoading, setPushLoading] = useState(false);
  const [testPushLoading, setTestPushLoading] = useState(false);
  const [testPushMessage, setTestPushMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "denied") {
        setPushStatus("blocked");
      } else if (Notification.permission === "granted") {
        setPushStatus("active");
      } else {
        setPushStatus("disabled");
      }
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await getNotificationPreferencesAction();
        if (res.ok) {
          setPreferences(res.data);
          setQuietStart(res.data.quietHoursStart ?? "");
          setQuietEnd(res.data.quietHoursEnd ?? "");
          setTimeZone(
            res.data.timeZone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "Asia/Manila",
          );
        }
      } catch (err) {
        console.error("[preferences] Failed to load:", err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const handleToggle = async (
    key: keyof Pick<
      NotificationPreferencesState,
      | "taskReminders"
      | "calendarReminders"
      | "schoolClassReminders"
      | "blackboardNewItems"
      | "blackboardDeadlineChanges"
    >,
    notificationType: string,
  ) => {
    const nextVal = !preferences[key];
    setPreferences((prev) => ({ ...prev, [key]: nextVal }));

    await saveNotificationPreferenceAction(notificationType, nextVal);
  };

  const handleSaveQuietHours = async () => {
    setSavingQuiet(true);
    setQuietSaved(false);
    try {
      await saveQuietHoursAction(
        quietStart ? quietStart : null,
        quietEnd ? quietEnd : null,
        timeZone,
        preferences.dailyDigest,
      );
      setQuietSaved(true);
      setTimeout(() => setQuietSaved(false), 3000);
    } catch (err) {
      console.error("[preferences] Failed to save quiet hours:", err);
    } finally {
      setSavingQuiet(false);
    }
  };

  const handleEnablePush = async () => {
    if (!("Notification" in window)) return;
    setPushLoading(true);

    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setPushStatus("active");

        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

          try {
            const sub = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapidKey || undefined,
            });

            const json = sub.toJSON();
            if (json.endpoint && json.keys?.p256dh && json.keys.auth) {
              await registerPushSubscriptionAction({
                endpoint: json.endpoint,
                keys: {
                  p256dh: json.keys.p256dh,
                  auth: json.keys.auth,
                },
              });
            }
          } catch (err) {
            console.error("[push] Failed to subscribe with PushManager:", err);
          }
        }
      } else if (permission === "denied") {
        setPushStatus("blocked");
      }
    } catch (err) {
      console.error("[push] Permission request failed:", err);
    } finally {
      setPushLoading(false);
    }
  };

  const handleDisablePush = async () => {
    setPushLoading(true);
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await disablePushSubscriptionAction(sub.endpoint);
        }
      }
      setPushStatus("disabled");
    } catch (err) {
      console.error("[push] Failed to disable push:", err);
    } finally {
      setPushLoading(false);
    }
  };

  const handleSendTestPush = async () => {
    setTestPushLoading(true);
    setTestPushMessage(null);
    try {
      const res = await sendTestNotificationAction();
      setTestPushMessage(
        res.ok
          ? "Test notification dispatched to your push endpoints."
          : `Failed to send test: ${res.message}`,
      );
      setTimeout(() => setTestPushMessage(null), 5000);
    } catch {
      setTestPushMessage("Error sending test notification.");
    } finally {
      setTestPushLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Category Toggles */}
      <Surface variant="base" className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Notification Categories</h3>
          <p className={styles.cardDescription}>
            Control which personal domains and integrations surface meaningful in-app updates.
          </p>
        </div>

        <div className={styles.toggleList}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <ListTodo size={16} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Tasks</h4>
                <p className={styles.toggleDetail}>
                  Reminders for tasks due today, upcoming deadlines, and overdue items.
                </p>
              </div>
            </div>
            <Toggle
              checked={preferences.taskReminders}
              onChange={() => handleToggle("taskReminders", "task_reminders")}
              disabled={loading}
              aria-label="Toggle task reminders"
            />
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <CalendarDays size={16} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Calendar</h4>
                <p className={styles.toggleDetail}>
                  Alerts for upcoming native events and scheduled commitments.
                </p>
              </div>
            </div>
            <Toggle
              checked={preferences.calendarReminders}
              onChange={() => handleToggle("calendarReminders", "calendar_reminders")}
              disabled={loading}
              aria-label="Toggle calendar reminders"
            />
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <GraduationCap size={16} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>School</h4>
                <p className={styles.toggleDetail}>
                  Reminders for upcoming course lectures, labs, and meetings.
                </p>
              </div>
            </div>
            <Toggle
              checked={preferences.schoolClassReminders}
              onChange={() => handleToggle("schoolClassReminders", "school_class_reminders")}
              disabled={loading}
              aria-label="Toggle school class reminders"
            />
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <ShieldCheck size={16} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Blackboard: New Items</h4>
                <p className={styles.toggleDetail}>
                  Alerts when newly discovered assignments or calendar entries are ready for review.
                </p>
              </div>
            </div>
            <Toggle
              checked={preferences.blackboardNewItems}
              onChange={() => handleToggle("blackboardNewItems", "blackboard_new_items")}
              disabled={loading}
              aria-label="Toggle new Blackboard item notifications"
            />
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <ShieldCheck size={16} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Blackboard: Deadline Changes</h4>
                <p className={styles.toggleDetail}>
                  Alerts when an existing syllabus or assignment deadline materially shifts.
                </p>
              </div>
            </div>
            <Toggle
              checked={preferences.blackboardDeadlineChanges}
              onChange={() =>
                handleToggle("blackboardDeadlineChanges", "blackboard_deadline_changes")
              }
              disabled={loading}
              aria-label="Toggle Blackboard deadline change notifications"
            />
          </div>
        </div>
      </Surface>

      {/* Quiet Hours */}
      <Surface variant="base" className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Quiet Hours</h3>
          <p className={styles.cardDescription}>
            During quiet hours, push notifications are deferred to prevent distractions. In-app
            notifications remain quietly accessible in your Notification Center.
          </p>
        </div>

        <div className={styles.quietGrid}>
          <div className={styles.quietField}>
            <label className={styles.quietLabel} htmlFor="quiet-start">
              Start Time
            </label>
            <input
              id="quiet-start"
              type="time"
              className={styles.quietInput}
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className={styles.quietField}>
            <label className={styles.quietLabel} htmlFor="quiet-end">
              End Time
            </label>
            <input
              id="quiet-end"
              type="time"
              className={styles.quietInput}
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className={styles.quietField}>
            <label className={styles.quietLabel} htmlFor="quiet-tz">
              Timezone
            </label>
            <input
              id="quiet-tz"
              type="text"
              className={styles.quietInput}
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              disabled={loading}
              placeholder="e.g. Asia/Manila"
            />
          </div>
        </div>

        <div className={styles.quietActions}>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveQuietHours}
            disabled={savingQuiet || loading}
            loading={savingQuiet}
          >
            {savingQuiet ? "Saving…" : "Save Quiet Hours"}
          </Button>

          {quietSaved ? (
            <Callout variant="success">Quiet hours updated successfully.</Callout>
          ) : null}
        </div>
      </Surface>

      {/* Web / Mobile Push Notifications */}
      <Surface variant="base" className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Web & Mobile Push Notifications</h3>
          <p className={styles.cardDescription}>
            Receive subtle, privacy-conscious notifications on this device even when the
            application is closed.
          </p>
        </div>

        <div className={styles.pushStatusRow}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span className={styles.toggleIcon} aria-hidden="true">
              <Smartphone size={16} />
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <strong style={{ fontSize: "0.9rem" }}>Push Notifications</strong>
                <Badge
                  tone={
                    pushStatus === "active"
                      ? "success"
                      : pushStatus === "blocked"
                      ? "destructive"
                      : "neutral"
                  }
                  size="sm"
                >
                  {pushStatus === "active"
                    ? "Active"
                    : pushStatus === "blocked"
                    ? "Blocked"
                    : pushStatus === "unsupported"
                    ? "Unsupported"
                    : "Off"}
                </Badge>
              </div>
              <p className={styles.toggleDetail}>
                {pushStatus === "active"
                  ? "This device is registered to receive Web Push notifications."
                  : pushStatus === "blocked"
                  ? "Notifications are blocked by your browser settings."
                  : pushStatus === "unsupported"
                  ? "Web Push is not supported in this browser."
                  : "Push notifications are currently disabled."}
              </p>
            </div>
          </div>

          <div className={styles.pushActions}>
            {pushStatus === "active" ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSendTestPush}
                  disabled={testPushLoading || pushLoading}
                  loading={testPushLoading}
                >
                  {testPushLoading ? "Sending…" : "Send Test"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisablePush}
                  disabled={pushLoading || testPushLoading}
                >
                  {pushLoading ? "Updating…" : "Disable"}
                </Button>
              </>
            ) : pushStatus === "disabled" ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleEnablePush}
                disabled={pushLoading}
                loading={pushLoading}
              >
                {pushLoading ? "Requesting…" : "Enable Push"}
              </Button>
            ) : null}
          </div>
        </div>

        {testPushMessage ? (
          <Callout variant="info" role="status">
            {testPushMessage}
          </Callout>
        ) : null}

        {pushStatus === "blocked" ? (
          <Callout variant="warning">
            To enable push notifications, open your browser site settings and allow
            notifications for this site.
          </Callout>
        ) : null}
      </Surface>
    </div>
  );
}
