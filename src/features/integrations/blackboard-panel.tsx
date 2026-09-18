"use client";

import {
  AlertTriangle,
  Inbox,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import type { BlackboardEmailStatus } from "@/services/integrations/blackboard/blackboard-repository";

import {
  mapBlackboardEmailCourseAction,
  retryBlackboardEmailAction,
} from "./blackboard-actions";
import styles from "./blackboard-panel.module.css";

type BlackboardPanelProps = {
  status: BlackboardEmailStatus;
};

export function BlackboardPanel({ status }: BlackboardPanelProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [targetCourseIds, setTargetCourseIds] = useState<Record<string, string>>({});

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await action();
      setMessage(res.message);
    });
  }

  function handleMapCourse(sourceKey: string, eventId: string) {
    const courseId = targetCourseIds[sourceKey] || status.courses[0]?.id;
    if (!courseId) return;

    run(async () => {
      const mapRes = await mapBlackboardEmailCourseAction(sourceKey, courseId);
      if (!mapRes.ok) return mapRes;
      return retryBlackboardEmailAction(eventId);
    });
  }

  function handleRetry(eventId: string) {
    run(() => retryBlackboardEmailAction(eventId));
  }

  return (
    <div className={styles.layout}>
      {/* 1. Ingestion Overview Card */}
      <Surface variant="glass" className={styles.card}>
        <header>
          <Mail size={20} />
          <div>
            <p>Notification Ingestion</p>
            <h2>{status.configured ? "Ingestion active" : "Not configured"}</h2>
          </div>
          <Badge tone={status.configured ? "success" : "warning"} size="sm">
            {status.configured ? "Active" : "Action required"}
          </Badge>
        </header>

        <p className={styles.copy}>
          Automatic school updates from Blackboard notification emails forwarded to Redline.
          Assignments, quizzes, and exams deterministically create linked Tasks; materials and announcements appear as School activity.
        </p>

        <div className={styles.statsRow} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Badge tone="neutral" size="sm">
            Total: {status.eventCounts.total}
          </Badge>
          <Badge tone="success" size="sm">
            Processed: {status.eventCounts.processed}
          </Badge>
          {status.eventCounts.unresolved > 0 ? (
            <Badge tone="warning" size="sm">
              Unresolved: {status.eventCounts.unresolved}
            </Badge>
          ) : null}
          {status.eventCounts.ignored > 0 ? (
            <Badge tone="neutral" size="sm">
              Ignored: {status.eventCounts.ignored}
            </Badge>
          ) : null}
        </div>

        {status.latestEvent ? (
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Latest event:</span>
            <span>
              {new Date(status.latestEvent.receivedAt).toLocaleString()} —{" "}
              {status.latestEvent.title || status.latestEvent.itemType || "School notice"}
            </span>
            <span>Status: <Badge tone={status.latestEvent.status === "processed" ? "success" : "neutral"} size="sm">{status.latestEvent.status}</Badge></span>
          </div>
        ) : (
          <p className={styles.emptyState}>No school emails received yet.</p>
        )}

        {message ? (
          <Callout tone="info" title="Status">
            {message}
          </Callout>
        ) : null}
      </Surface>

      {/* 2. Sync / Security Architecture Card */}
      <Surface variant="glass" className={styles.card}>
        <header>
          <ShieldCheck size={20} />
          <div>
            <p>Architecture</p>
            <h2>Email-only security</h2>
          </div>
        </header>

        <p className={styles.copy}>
          Project Redline uses webhook-verified notification emails forwarded from Outlook.
          Calendar feed polling, iCalendar credentials, and web scraping are permanently removed.
        </p>

        <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.8125rem", color: "var(--text-secondary)", display: "grid", gap: "0.4rem" }}>
          <li>No stored Blackboard feed URLs or cleartext passwords.</li>
          <li>DNS pinning and SSRF-hardened inbound webhook verification.</li>
          <li>Tasks created from school emails remain normal native Tasks.</li>
          <li>Courses and schedules managed directly in <Link href="/school" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>School</Link>.</li>
        </ul>
      </Surface>

      {/* 3. Course Mapping Issues (if any) */}
      {(status.courseMappingIssues ?? []).length > 0 ? (
        <Surface variant="glass" className={`${styles.card} ${styles.fullWidth}`}>
          <header>
            <AlertTriangle size={20} />
            <div>
              <p>Action needed</p>
              <h2>
                {(status.courseMappingIssues ?? []).length} Course Mapping{" "}
                {(status.courseMappingIssues ?? []).length === 1 ? "Issue" : "Issues"}
              </h2>
            </div>
          </header>

          <p className={styles.copy}>
            These emails could not be mapped to a Redline course automatically. Map the source course identifier to resolve and process the item.
          </p>

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
            {(status.courseMappingIssues ?? []).map((issue) => {
              const parsed = issue.parsedEvent as {
                title?: string;
                courseKey?: string;
                baseCourseCode?: string;
                courseHint?: string;
                sourceCourseKey?: string;
                courseCode?: string;
                rawCourseHeader?: string;
                itemType?: string;
              };
              const courseKey =
                parsed.courseKey ||
                parsed.baseCourseCode ||
                parsed.courseHint ||
                parsed.sourceCourseKey ||
                parsed.rawCourseHeader ||
                parsed.courseCode ||
                "Unknown course";

              return (
                <li
                  key={issue.id}
                  style={{
                    padding: "0.85rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
                    <strong>{parsed.title || "School Notification"}</strong>
                    <Badge tone="warning" size="sm">{issue.status}</Badge>
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                    Source identifier: <code>{courseKey}</code>
                  </div>

                  {status.courses.length > 0 ? (
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.25rem" }}>
                      <Select
                        value={targetCourseIds[courseKey] || status.courses[0]?.id || ""}
                        onChange={(val) => setTargetCourseIds((prev) => ({ ...prev, [courseKey]: val }))}
                        options={status.courses.map((c) => ({
                          value: c.id,
                          label: `${c.code} — ${c.name}`,
                        }))}
                        ariaLabel={`Assign course for ${courseKey}`}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={pending}
                        onClick={() => handleMapCourse(courseKey, issue.id)}
                      >
                        Map & Retry
                      </Button>
                    </div>
                  ) : (
                    <Callout tone="warning" title="No courses found">
                      Add courses in <Link href="/school">School</Link> to assign this item.
                    </Callout>
                  )}
                </li>
              );
            })}
          </ul>
        </Surface>
      ) : null}

      {/* 4. Recent Inbound Activity */}
      <Surface variant="base" className={`${styles.card} ${styles.fullWidth}`}>
        <header>
          <Inbox size={20} />
          <div>
            <p>Activity log</p>
            <h2>Recent school email events</h2>
          </div>
        </header>

        {status.recentEvents.length > 0 ? (
          <ul className={styles.runs}>
            {status.recentEvents.map((event) => {
              const parsed = event.parsedEvent as {
                title?: string;
                itemType?: string;
                notificationType?: string;
                dueDate?: string;
              };

              return (
                <li
                  key={event.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <div>
                    <strong>{parsed.title || parsed.notificationType || "School notice"}</strong>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.75rem", color: "var(--text-tertiary)", marginTop: "0.2rem" }}>
                      <span>{new Date(event.receivedAt).toLocaleString()}</span>
                      {parsed.itemType ? <span>· {parsed.itemType}</span> : null}
                      {parsed.dueDate ? <span>· Due {parsed.dueDate}</span> : null}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Badge
                      tone={
                        event.status === "processed"
                          ? "success"
                          : event.status.startsWith("unresolved_")
                            ? "warning"
                            : event.status === "ignored"
                              ? "neutral"
                              : "destructive"
                      }
                      size="sm"
                    >
                      {event.status}
                    </Badge>

                    {event.status !== "processed" && event.status !== "ignored" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending}
                        icon={<RefreshCw size={12} />}
                        onClick={() => handleRetry(event.id)}
                      >
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.emptyState}>No school email events recorded yet.</p>
        )}
      </Surface>
    </div>
  );
}
