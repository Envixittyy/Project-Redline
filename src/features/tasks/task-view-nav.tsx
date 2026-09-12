"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Popover } from "@/components/ui/popover";
import type { TaskView } from "@/types/task";

import styles from "./task-view-nav.module.css";

const primaryViews: Array<{ id: TaskView; label: string }> = [
  { id: "today", label: "Today" },
  { id: "next7", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "inbox", label: "Inbox" },
];

const secondaryViews: Array<{ id: TaskView; label: string }> = [
  { id: "tomorrow", label: "Tomorrow" },
  { id: "someday", label: "Someday" },
  { id: "submitted", label: "Submitted" },
  { id: "completed", label: "Completed" },
];

type TaskViewNavProps = {
  current: TaskView;
  overdueCount?: number;
};

export function TaskViewNav({ current, overdueCount }: TaskViewNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
    ready: boolean;
  }>({
    left: 0,
    width: 0,
    ready: false,
  });
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const activeEl = track.querySelector<HTMLElement>("[data-active='true']");
    if (!activeEl) {
      setIndicator((prev) => ({ ...prev, ready: false }));
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();

    setIndicator({
      left: activeRect.left - trackRect.left + track.scrollLeft,
      width: activeRect.width,
      ready: true,
    });

    const timer = setTimeout(() => setAnimated(true), 50);
    return () => clearTimeout(timer);
  }, [current]);

  const activeSecondary = secondaryViews.find((v) => v.id === current);
  const isSecondaryActive = Boolean(activeSecondary);

  return (
    <nav className={styles.nav} aria-label="Task views">
      <div className={styles.navBar}>
        <div ref={trackRef} className={styles.segmentsTrack} role="tablist" aria-label="Primary task views">
          <span
            className={styles.trackIndicator}
            style={{
              transform: `translate3d(${indicator.left}px, 0, 0)`,
              width: `${indicator.width}px`,
            }}
            data-ready={indicator.ready || undefined}
            data-animated={animated || undefined}
            aria-hidden="true"
          />
          {primaryViews.map((view) => {
            const active = view.id === current;
            const showOverdueBadge = view.id === "overdue" && overdueCount !== undefined && overdueCount > 0;

            return (
              <Link
                key={view.id}
                className={styles.segment}
                href={`/tasks?view=${view.id}`}
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
              >
                <span>{view.label}</span>
                {showOverdueBadge ? (
                  <span className={styles.overdueBadge} aria-label={`${overdueCount} overdue`}>
                    {overdueCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className={styles.popoverWrap}>
          <Popover
            isOpen={moreOpen}
            onClose={() => setMoreOpen(false)}
            placement="bottom-end"
            role="menu"
            ariaLabel="More task views"
            trigger={
              <button
                type="button"
                className={styles.moreButton}
                data-active={isSecondaryActive || undefined}
                onClick={() => setMoreOpen(!moreOpen)}
                aria-expanded={moreOpen}
              >
                <span>{activeSecondary ? activeSecondary.label : "More"}</span>
                <ChevronDown
                  size={14}
                  className={styles.chevron}
                  data-open={moreOpen || undefined}
                  aria-hidden="true"
                />
              </button>
            }
          >
            <div className={styles.menuList}>
              {secondaryViews.map((view) => {
                const active = view.id === current;
                return (
                  <Link
                    key={view.id}
                    href={`/tasks?view=${view.id}`}
                    className={styles.menuItem}
                    data-active={active || undefined}
                    onClick={() => setMoreOpen(false)}
                    role="menuitem"
                  >
                    <span>{view.label}</span>
                    {active ? (
                      <span className={styles.activeDot} aria-hidden="true" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </Popover>
        </div>
      </div>
    </nav>
  );
}

