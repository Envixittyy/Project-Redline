"use client";

import {
  Bell,
  CalendarDays,
  CheckCheck,
  GraduationCap,
  ListTodo,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import {
  formatNotificationTimestamp,
  getNotificationDomain,
  getNotificationDomainLabel,
  groupNotificationsByDate,
} from "@/services/notifications/notification-domain";
import type { NotificationDomain, NotificationEvent } from "@/types/notification";
import {
  deleteNotificationAction,
  getNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  markNotificationUnreadAction,
} from "./notification-actions";
import {
  notificationsUpdatedEvent,
  openNotificationsEvent,
} from "./notification-trigger";
import styles from "./notification-center.module.css";

function DomainIcon({ domain }: { domain: NotificationDomain }) {
  switch (domain) {
    case "blackboard":
      return <ShieldCheck size={17} aria-hidden="true" />;
    case "tasks":
      return <ListTodo size={17} aria-hidden="true" />;
    case "calendar":
      return <CalendarDays size={17} aria-hidden="true" />;
    case "school":
      return <GraduationCap size={17} aria-hidden="true" />;
    case "system":
    default:
      return <Sparkles size={17} aria-hidden="true" />;
  }
}

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");
  const [timeZone] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila";
      } catch {
        return "Asia/Manila";
      }
    }
    return "Asia/Manila";
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getNotificationsAction(50);
      if (res.ok) {
        setNotifications(res.data.notifications);
        setUnreadCount(res.data.unreadCount);
      }
    } catch (err) {
      console.error("[notifications] Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    function handleOpen() {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpen(true);
      void fetchNotifications();
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && open) {
        setOpen(false);
      }
    }

    window.addEventListener(openNotificationsEvent, handleOpen);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(openNotificationsEvent, handleOpen);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, fetchNotifications]);

  useEffect(() => {
    if (!open) {
      returnFocusRef.current?.focus();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handleMarkAllRead = async () => {
    // Optimistic UI update
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
    setUnreadCount(0);
    window.dispatchEvent(new Event(notificationsUpdatedEvent));

    await markAllNotificationsReadAction();
    await fetchNotifications();
  };

  const handleToggleRead = async (
    event: MouseEvent,
    item: NotificationEvent,
  ) => {
    event.stopPropagation();
    const isUnread = !item.readAt;

    if (isUnread) {
      // Mark read
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      window.dispatchEvent(new Event(notificationsUpdatedEvent));
      await markNotificationReadAction(item.id);
    } else {
      // Mark unread
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, readAt: null } : n)),
      );
      setUnreadCount((prev) => prev + 1);
      window.dispatchEvent(new Event(notificationsUpdatedEvent));
      await markNotificationUnreadAction(item.id);
    }
  };

  const handleDelete = async (event: MouseEvent, eventId: string) => {
    event.stopPropagation();
    const target = notifications.find((n) => n.id === eventId);
    if (target && !target.readAt) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    setNotifications((prev) => prev.filter((n) => n.id !== eventId));
    window.dispatchEvent(new Event(notificationsUpdatedEvent));
    await deleteNotificationAction(eventId);
  };

  const handleItemClick = async (item: NotificationEvent) => {
    if (!item.readAt) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      window.dispatchEvent(new Event(notificationsUpdatedEvent));
      void markNotificationReadAction(item.id);
    }
    setOpen(false);
    if (item.deepLink && item.deepLink.startsWith("/")) {
      router.push(item.deepLink);
    }
  };

  const filteredItems = useMemo(() => {
    if (activeTab === "unread") {
      return notifications.filter((n) => !n.readAt);
    }
    return notifications;
  }, [notifications, activeTab]);

  const groups = useMemo(() => {
    return groupNotificationsByDate(filteredItems, timeZone);
  }, [filteredItems, timeZone]);

  if (!open) return null;

  const totalCount = notifications.length;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <div
        className={styles.backdrop}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div className={styles.drawer} ref={panelRef}>
        <header className={styles.header}>
          <div className={styles.titleArea}>
            <h2 className={styles.title}>Notifications</h2>
            {unreadCount > 0 ? (
              <span className={styles.unreadPill}>{unreadCount}</span>
            ) : null}
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.markAllBtn}
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
              title="Mark all as read"
            >
              <CheckCheck size={14} style={{ marginRight: 4 }} />
              Mark all read
            </button>

            <Link
              href="/settings/notifications"
              className={styles.iconBtn}
              onClick={() => setOpen(false)}
              title="Notification settings"
              aria-label="Notification settings"
            >
              <Settings size={17} />
            </Link>

            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setOpen(false)}
              title="Close notifications"
              aria-label="Close notifications"
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "all"}
            className={styles.tab}
            data-active={activeTab === "all"}
            onClick={() => setActiveTab("all")}
          >
            All {totalCount > 0 ? `(${totalCount})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "unread"}
            className={styles.tab}
            data-active={activeTab === "unread"}
            onClick={() => setActiveTab("unread")}
          >
            Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
          </button>
        </div>

        <div className={styles.content}>
          {loading && notifications.length === 0 ? (
            <div className={styles.loading}>
              <Sparkles size={16} className="animate-spin" />
              <span>Loading updates…</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <Bell size={24} />
              </span>
              <h3>
                {activeTab === "unread"
                  ? "All caught up"
                  : "No notifications yet"}
              </h3>
              <p>
                {activeTab === "unread"
                  ? "You have reviewed all current notifications."
                  : "Meaningful alerts from Tasks, Calendar, School, and Blackboard will appear here."}
              </p>
            </div>
          ) : (
            <>
              {groups.today.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Today</h3>
                  <div className={styles.list}>
                    {groups.today.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        timeZone={timeZone}
                        onClick={() => handleItemClick(item)}
                        onToggleRead={(e) => handleToggleRead(e, item)}
                        onDelete={(e) => handleDelete(e, item.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {groups.yesterday.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Yesterday</h3>
                  <div className={styles.list}>
                    {groups.yesterday.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        timeZone={timeZone}
                        onClick={() => handleItemClick(item)}
                        onToggleRead={(e) => handleToggleRead(e, item)}
                        onDelete={(e) => handleDelete(e, item.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {groups.earlier.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Earlier</h3>
                  <div className={styles.list}>
                    {groups.earlier.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        timeZone={timeZone}
                        onClick={() => handleItemClick(item)}
                        onToggleRead={(e) => handleToggleRead(e, item)}
                        onDelete={(e) => handleDelete(e, item.id)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationCard({
  item,
  timeZone,
  onClick,
  onToggleRead,
  onDelete,
}: {
  item: NotificationEvent;
  timeZone: string;
  onClick: () => void;
  onToggleRead: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
}) {
  const isUnread = !item.readAt;
  const domain = getNotificationDomain(item.eventType);
  const domainLabel = getNotificationDomainLabel(domain);
  const formattedTime = formatNotificationTimestamp(item.createdAt, timeZone);

  return (
    <article
      className={styles.card}
      data-unread={isUnread}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div
        className={styles.domainIconFrame}
        data-domain={domain}
        aria-hidden="true"
      >
        <DomainIcon domain={domain} />
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardMeta}>
          <span className={styles.domainLabel}>{domainLabel}</span>
          <span className={styles.timestamp}>{formattedTime}</span>
        </div>

        <h4 className={styles.itemTitle}>{item.title}</h4>
        {item.body ? <p className={styles.itemSummary}>{item.body}</p> : null}

        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onToggleRead}
            title={isUnread ? "Mark as read" : "Mark as unread"}
          >
            {isUnread ? "Mark read" : "Mark unread"}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onDelete}
            title="Delete notification"
            aria-label="Delete notification"
          >
            <Trash2 size={13} style={{ verticalAlign: "middle" }} />
          </button>
        </div>
      </div>

      {isUnread ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
    </article>
  );
}

