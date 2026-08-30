"use client";

import {
  CalendarDays,
  Check,
  GraduationCap,
  ListTodo,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";

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
  >(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    if (Notification.permission === "denied") return "blocked";
    if (Notification.permission === "granted") return "active";
    return "disabled";
  });
  const [pushLoading, setPushLoading] = useState(false);
  const [testPushLoading, setTestPushLoading] = useState(false);
  const [testPushMessage, setTestPushMessage] = useState<string | null>(null);

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
                expirationTime: sub.expirationTime,
              });
            }
          } catch (subErr) {
            console.warn(
              "[push] Local browser subscription created without remote push gateway:",
              subErr,
            );
          }
        }
      } else if (permission === "denied") {
        setPushStatus("blocked");
      } else {
        setPushStatus("disabled");
      }
    } catch (err) {
      console.error("[push] Request permission error:", err);
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
          await disablePushSubscriptionAction(sub.endpoint);
          await sub.unsubscribe();
        }
      }
      setPushStatus("disabled");
    } catch (err) {
      console.error("[push] Disable push error:", err);
    } finally {
      setPushLoading(false);
    }
  };

  const handleSendTestPush = async () => {
    setTestPushLoading(true);
    setTestPushMessage(null);
    try {
      const res = await sendTestNotificationAction();
      if (res.ok) {
        setTestPushMessage(res.data.message);
      } else {
        setTestPushMessage(res.message);
      }
    } catch (err) {
      console.error("[push] Test notification error:", err);
      setTestPushMessage("Failed to send test notification.");
    } finally {
      setTestPushLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Category Toggles */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Notification Categories</h3>
          <p className={styles.cardDescription}>
            Control which personal domains and integrations surface meaningful
            in-app updates.
          </p>
        </div>

        <div className={styles.toggleList}>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <ListTodo size={17} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Tasks</h4>
                <p className={styles.toggleDetail}>
                  Reminders for tasks due today, upcoming deadlines, and overdue
                  items.
                </p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={preferences.taskReminders}
                onChange={() => handleToggle("taskReminders", "task_reminders")}
                disabled={loading}
                aria-label="Toggle task reminders"
              />
              <span className={styles.slider} />
            </label>
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <CalendarDays size={17} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Calendar</h4>
                <p className={styles.toggleDetail}>
                  Alerts for upcoming native events and scheduled commitments.
                </p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={preferences.calendarReminders}
                onChange={() =>
                  handleToggle("calendarReminders", "calendar_reminders")
                }
                disabled={loading}
                aria-label="Toggle calendar reminders"
              />
              <span className={styles.slider} />
            </label>
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <GraduationCap size={17} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>School</h4>
                <p className={styles.toggleDetail}>
                  Reminders for upcoming course lectures, labs, and meetings.
                </p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={preferences.schoolClassReminders}
                onChange={() =>
                  handleToggle("schoolClassReminders", "school_class_reminders")
                }
                disabled={loading}
                aria-label="Toggle school class reminders"
              />
              <span className={styles.slider} />
            </label>
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <ShieldCheck size={17} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Blackboard: New Items</h4>
                <p className={styles.toggleDetail}>
                  Alerts when newly discovered assignments or calendar entries
                  are ready for review.
                </p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={preferences.blackboardNewItems}
                onChange={() =>
                  handleToggle("blackboardNewItems", "blackboard_new_items")
                }
                disabled={loading}
                aria-label="Toggle new Blackboard item notifications"
              />
              <span className={styles.slider} />
            </label>
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleIcon} aria-hidden="true">
                <ShieldCheck size={17} />
              </span>
              <div>
                <h4 className={styles.toggleLabel}>Blackboard: Deadline Changes</h4>
                <p className={styles.toggleDetail}>
                  Alerts when an existing syllabus or assignment deadline
                  materially shifts.
                </p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={preferences.blackboardDeadlineChanges}
                onChange={() =>
                  handleToggle(
                    "blackboardDeadlineChanges",
                    "blackboard_deadline_changes",
                  )
                }
                disabled={loading}
                aria-label="Toggle Blackboard deadline change notifications"
              />
              <span className={styles.slider} />
            </label>
          </div>
        </div>
      </div>

      {/* Quiet Hours */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Quiet Hours</h3>
          <p className={styles.cardDescription}>
            During quiet hours, push notifications are deferred to prevent
            distractions. In-app notifications remain quietly accessible in your
            Notification Center.
          </p>
        </div>

        <div className={styles.quietGrid}>
          <div className={styles.field}>
            <label htmlFor="quiet-start">Start Time</label>
            <input
              id="quiet-start"
              type="time"
              className={styles.input}
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="quiet-end">End Time</label>
            <input
              id="quiet-end"
              type="time"
              className={styles.input}
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="quiet-tz">Timezone</label>
            <input
              id="quiet-tz"
              type="text"
              className={styles.input}
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              disabled={loading}
              placeholder="e.g. Asia/Manila"
            />
          </div>
        </div>

        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSaveQuietHours}
          disabled={savingQuiet || loading}
        >
          {savingQuiet ? "Saving…" : "Save Quiet Hours"}
        </button>

        {quietSaved ? (
          <p className={styles.savedToast} role="status">
            <Check size={14} style={{ display: "inline", marginRight: 4 }} />
            Quiet hours updated successfully.
          </p>
        ) : null}
      </div>

      {/* Web / Mobile Push Notifications */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Web & Mobile Push Notifications</h3>
          <p className={styles.cardDescription}>
            Receive subtle, privacy-conscious notifications on this device even
            when the application is closed.
          </p>
        </div>

        <div className={styles.pushStatusRow}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span className={styles.toggleIcon} aria-hidden="true">
              <Smartphone size={17} />
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <strong style={{ fontSize: "0.9rem" }}>Push Notifications</strong>
                <span
                  className={styles.pushBadge}
                  data-status={pushStatus}
                >
                  {pushStatus === "active"
                    ? "Active"
                    : pushStatus === "blocked"
                      ? "Blocked"
                      : pushStatus === "unsupported"
                        ? "Unsupported"
                        : "Off"}
                </span>
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

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {pushStatus === "active" ? (
              <>
                <button
                  type="button"
                  className={styles.pushActionBtn}
                  onClick={handleSendTestPush}
                  disabled={testPushLoading || pushLoading}
                >
                  {testPushLoading ? "Sending…" : "Send Test Notification"}
                </button>
                <button
                  type="button"
                  className={styles.pushActionBtn}
                  onClick={handleDisablePush}
                  disabled={pushLoading || testPushLoading}
                >
                  {pushLoading ? "Updating…" : "Disable Push"}
                </button>
              </>
            ) : pushStatus === "disabled" ? (
              <button
                type="button"
                className={styles.pushActionBtn}
                onClick={handleEnablePush}
                disabled={pushLoading}
              >
                {pushLoading ? "Requesting…" : "Enable Push Notifications"}
              </button>
            ) : null}
          </div>
        </div>

        {testPushMessage ? (
          <p className={styles.savedToast} role="status">
            {testPushMessage}
          </p>
        ) : null}

        {pushStatus === "blocked" ? (
          <p className={styles.pushNotice}>
            To enable push notifications, open your browser site settings and
            allow notifications for this site.
          </p>
        ) : null}
      </div>
    </div>
  );
}

