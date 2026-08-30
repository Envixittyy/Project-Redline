"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

import { getUnreadCountAction } from "./notification-actions";
import styles from "./notification-trigger.module.css";

export const openNotificationsEvent = "forward:open-notifications";
export const notificationsUpdatedEvent = "forward:notifications-updated";

export function NotificationTrigger({ compact = false }: { compact?: boolean }) {
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    let active = true;

    async function loadUnread() {
      try {
        const res = await getUnreadCountAction();
        if (active && res.ok) {
          setUnreadCount(res.data);
        }
      } catch {
        // Best-effort unread badge read
      }
    }

    void loadUnread();

    const handleUpdate = () => {
      void loadUnread();
    };

    window.addEventListener(notificationsUpdatedEvent, handleUpdate);
    window.addEventListener("focus", handleUpdate);

    return () => {
      active = false;
      window.removeEventListener(notificationsUpdatedEvent, handleUpdate);
      window.removeEventListener("focus", handleUpdate);
    };
  }, []);

  const handleClick = () => {
    window.dispatchEvent(new Event(openNotificationsEvent));
  };

  const badgeText = unreadCount > 9 ? "9+" : `${unreadCount}`;

  return (
    <button
      type="button"
      className={compact ? styles.compactTrigger : styles.trigger}
      aria-label={
        unreadCount > 0
          ? `Open notifications (${unreadCount} unread)`
          : "Open notifications"
      }
      onClick={handleClick}
    >
      <Bell size={compact ? 19 : 17} aria-hidden="true" />
      {compact ? null : <span>Notifications</span>}
      {unreadCount > 0 ? (
        <span className={compact ? styles.compactBadge : styles.badge}>
          {badgeText}
        </span>
      ) : null}
    </button>
  );
}
