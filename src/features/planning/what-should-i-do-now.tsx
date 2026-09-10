"use client";

import {
  CalendarDays,
  CheckCircle2,
  Compass,
  Hourglass,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import buttonStyles from "@/components/ui/button.module.css";
import { Surface } from "@/components/ui/surface";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { Task } from "@/types/task";

import { PlanMyDayDialog } from "./plan-my-day-dialog";
import {
  generateDayPlan,
  getWhatShouldIDoNow,
  type ActionRecommendation,
} from "./planning-domain";
import styles from "./what-should-i-do-now.module.css";

type WhatShouldIDoNowProps = {
  tasks: Task[];
  scheduleItems: CalendarItem[];
  timeZone: string;
  children?: ReactNode;
};

export function WhatShouldIDoNow({
  tasks,
  scheduleItems,
  timeZone,
  children,
}: WhatShouldIDoNowProps) {
  const [planningModalOpen, setPlanningModalOpen] = useState(false);

  const plan = useMemo(() => {
    return generateDayPlan({
      tasks,
      scheduleItems,
      timeZone,
    });
  }, [tasks, scheduleItems, timeZone]);

  const recommendation: ActionRecommendation = useMemo(() => {
    return getWhatShouldIDoNow(plan, new Date().toISOString(), timeZone);
  }, [plan, timeZone]);

  function renderIcon() {
    switch (recommendation.kind) {
      case "active_work_session":
        return <Zap size={20} aria-hidden="true" />;
      case "imminent_commitment":
        return <Hourglass size={20} aria-hidden="true" />;
      case "next_up_session":
        return <Compass size={20} aria-hidden="true" />;
      case "top_priority_task":
        return <Sparkles size={20} aria-hidden="true" />;
      case "schedule_clear":
        return <CheckCircle2 size={20} aria-hidden="true" />;
      case "no_tasks":
      case "no_schedulable_fit":
      default:
        return <CalendarDays size={20} aria-hidden="true" />;
    }
  }

  const isLiveAction =
    recommendation.kind === "active_work_session" ||
    recommendation.kind === "imminent_commitment";

  return (
    <>
      <Surface
        variant="glass"
        className={`${styles.container} ${isLiveAction ? styles.containerLive : ""} motion-enter`}
        data-dashboard-widget="planning"
      >
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <div
              className={styles.iconWrapper}
              data-kind={recommendation.kind}
            >
              {renderIcon()}
            </div>
            <div>
              <p className={styles.eyebrow}>What Should I Do Now?</p>
              <h3 className={styles.headline}>{recommendation.headline}</h3>
            </div>
          </div>
        </div>

        <p className={styles.description}>{recommendation.description}</p>

        <div className={styles.actions}>
          <Link
            href="/focus"
            className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md}`}
            title="Open distraction-free Focus Mode"
          >
            <Zap size={16} aria-hidden="true" />
            <span>Focus Mode</span>
          </Link>

          <Button
            variant="secondary"
            size="md"
            icon={<Compass size={16} />}
            onClick={() => setPlanningModalOpen(true)}
          >
            Plan My Day
          </Button>

          {"task" in recommendation && recommendation.task ? (
            <Link
              href={`/tasks?view=today`}
              className={`${buttonStyles.button} ${buttonStyles.ghost} ${buttonStyles.md}`}
            >
              <span>Open Task</span>
            </Link>
          ) : null}
        </div>

        {children ? <div className={styles.extraContent}>{children}</div> : null}
      </Surface>

      {planningModalOpen ? (
        <PlanMyDayDialog
          tasks={tasks}
          scheduleItems={scheduleItems}
          timeZone={timeZone}
          onClose={() => setPlanningModalOpen(false)}
        />
      ) : null}
    </>
  );
}
