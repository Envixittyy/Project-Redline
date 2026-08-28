"use client";

import { AlertTriangle, Bell, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import type { BlackboardStatus } from "@/services/integrations/blackboard/blackboard-repository";

import { configureBlackboardAction, syncBlackboardAction } from "./blackboard-actions";
import styles from "./blackboard-panel.module.css";
import { PushStatus } from "./push-status";

type BlackboardPanelProps = {
  status: BlackboardStatus;
  pushConfigured: boolean;
};

export function BlackboardPanel({ status, pushConfigured }: BlackboardPanelProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => setMessage((await action()).message));
  }

  return (
    <div className={styles.layout}>
      <Surface variant="glass" className={styles.card}>
        <header>
          <ShieldCheck size={20} />
          <div>
            <p>Private iCalendar feed</p>
            <h2>{status.connected ? "Connected" : "Not connected"}</h2>
          </div>
          <span data-state={status.syncState}>{status.syncState}</span>
        </header>
        <p className={styles.copy}>
          The feed URL is encrypted server-side and never returned to the browser. Only
          calendar-related Blackboard records are imported.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(() => configureBlackboardAction(data.get("feedUrl")));
          }}
        >
          <label>
            Private feed URL
            <input
              name="feedUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder={status.credentialHint
                ? `Connected to ${status.credentialHint}`
                : "https://…/calendar.ics"}
              required
            />
          </label>
          <button disabled={pending} type="submit">
            {status.connected ? "Replace credential" : "Connect feed"}
          </button>
        </form>
        {status.connected ? (
          <button
            className={styles.sync}
            disabled={pending || status.syncState === "syncing"}
            type="button"
            onClick={() => run(syncBlackboardAction)}
          >
            <RefreshCw size={16} />
            Sync now
          </button>
        ) : null}
        {message ? <p role="status" className={styles.message}>{message}</p> : null}
      </Surface>

      <Surface variant="base" className={styles.card}>
        <header>
          {status.lastErrorCode ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
          <div>
            <p>Sync health</p>
            <h2>
              {status.lastSuccessAt
                ? `Last success ${new Date(status.lastSuccessAt).toLocaleString()}`
                : "No successful sync yet"}
            </h2>
          </div>
        </header>
        {status.lastErrorCode
          ? <p className={styles.warning}>Action required: {status.lastErrorCode}</p>
          : null}
        <ul className={styles.runs}>
          {status.runs.map((run) => (
            <li key={run.id}>
              <strong>{run.status}</strong>
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              <small>{run.created} new · {run.updated} updated · {run.missing} missing</small>
            </li>
          ))}
        </ul>
      </Surface>

      <Surface variant="base" className={styles.card}>
        <header>
          <Bell size={20} />
          <div>
            <p>Notifications</p>
            <h2>{status.notifications.length} unread</h2>
          </div>
        </header>
        <PushStatus configured={pushConfigured} />
        <ul className={styles.notifications}>
          {status.notifications.map((item) => (
            <li key={item.id}>
              <Link href={item.deepLink}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Surface>
    </div>
  );
}
