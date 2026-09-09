"use client";

import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  FileSearch,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/surface";
import type { BlackboardStatus } from "@/services/integrations/blackboard/blackboard-repository";
import type { BlackboardCalendarCharacterization } from "@/services/integrations/blackboard/characterization";

import {
  assignBlackboardRecordsAction,
  characterizeBlackboardAction,
  configureBlackboardAction,
  deleteCourseMappingAction,
  saveCourseMappingAction,
  syncBlackboardAction,
} from "./blackboard-actions";
import styles from "./blackboard-panel.module.css";
import { PushStatus } from "./push-status";

type BlackboardPanelProps = {
  status: BlackboardStatus;
  pushConfigured: boolean;
};

export function BlackboardPanel({ status, pushConfigured }: BlackboardPanelProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [characterization, setCharacterization] =
    useState<BlackboardCalendarCharacterization | null>(null);

  // Manual mapping state
  const [newSourceCourse, setNewSourceCourse] = useState("");
  const [newTargetCourseId, setNewTargetCourseId] = useState(status.courses[0]?.id ?? "");

  // Unassigned queue selection & batch assignment
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [batchTargetCourseId, setBatchTargetCourseId] = useState(status.courses[0]?.id ?? "");
  const [rememberMapping, setRememberMapping] = useState(true);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await action();
      setMessage(res.message);
    });
  }

  function toggleRecordSelection(id: string) {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function inspectStructure() {
    startTransition(async () => {
      const res = await characterizeBlackboardAction();
      setMessage(res.message);
      if (res.ok) setCharacterization(res.report);
    });
  }

  function toggleSelectAll() {
    if (selectedRecordIds.size === status.unassigned.length) {
      setSelectedRecordIds(new Set());
    } else {
      setSelectedRecordIds(new Set(status.unassigned.map((r) => r.id)));
    }
  }

  function handleSaveMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!newSourceCourse.trim() || !newTargetCourseId) return;
    run(async () => {
      const res = await saveCourseMappingAction(newSourceCourse.trim(), newTargetCourseId);
      if (res.ok) setNewSourceCourse("");
      return res;
    });
  }

  function handleBatchAssign(e: React.FormEvent) {
    e.preventDefault();
    if (selectedRecordIds.size === 0 || !batchTargetCourseId) return;
    run(async () => {
      const res = await assignBlackboardRecordsAction(
        Array.from(selectedRecordIds),
        batchTargetCourseId,
        rememberMapping,
      );
      if (res.ok) setSelectedRecordIds(new Set());
      return res;
    });
  }

  return (
    <div className={styles.layout}>
      {/* 1. Feed Configuration Card */}
      <Surface variant="glass" className={styles.card}>
        <header>
          <ShieldCheck size={20} />
          <div>
            <p>Private iCalendar feed</p>
            <h2>{status.connected ? "Connected" : "Not connected"}</h2>
          </div>
          <span className={styles.stateTag} data-state={status.syncState}>
            {status.syncState}
          </span>
        </header>
        <p className={styles.modeLine}>
          Current mode: <strong>{status.mode}</strong>
        </p>
        <p className={styles.copy}>
          S1 email ingestion remains active. Calendar sync starts in observe mode, records
          auditable proposals, and cannot mutate School or Tasks until an operator enables apply mode.
          The private feed URL is encrypted server-side with AES-256-GCM.
        </p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(() => configureBlackboardAction(data.get("feedUrl")));
          }}
        >
          <label className={styles.field}>
            Private feed URL
            <input
              className={styles.input}
              name="feedUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder={
                status.credentialHint
                  ? `Connected to ${status.credentialHint}`
                  : "https://…/calendar.ics"
              }
              required
            />
          </label>
          <button className={styles.buttonPrimary} disabled={pending} type="submit">
            {status.connected ? "Replace credential" : "Connect feed"}
          </button>
        </form>
        {status.connected ? (
          <button
            className={styles.buttonSecondary}
            disabled={pending || status.syncState === "syncing" || status.mode === "off"}
            type="button"
            onClick={() => run(syncBlackboardAction)}
          >
            <RefreshCw size={16} />
            Sync now
          </button>
        ) : null}
        {status.connected ? (
          <button
            className={styles.buttonSecondary}
            disabled={pending || status.mode === "off"}
            type="button"
            onClick={inspectStructure}
          >
            <FileSearch size={16} />
            Inspect redacted structure
          </button>
        ) : null}
        {characterization ? (
          <details className={styles.report}>
            <summary>Redacted feed characterization</summary>
            <pre>{JSON.stringify(characterization, null, 2)}</pre>
          </details>
        ) : null}
        {message ? (
          <p role="status" className={styles.message}>
            {message}
          </p>
        ) : null}
      </Surface>

      {/* 2. Manual Course Mappings Card */}
      <Surface variant="glass" className={styles.card}>
        <header>
          <BookOpen size={20} />
          <div>
            <p>Deterministic course mapping</p>
            <h2>{status.mappings.length} Saved {status.mappings.length === 1 ? "Mapping" : "Mappings"}</h2>
          </div>
        </header>
        <p className={styles.copy}>
          Map Blackboard source course identifiers to canonical Redline courses. Resolution is 100% deterministic with zero AI guessing.
        </p>

        {status.mappings.length > 0 ? (
          <ul className={styles.mappingsList}>
            {status.mappings.map((m) => (
              <li key={m.id} className={styles.mappingItem}>
                <div className={styles.mappingSource}>
                  <strong>{m.sourceCourseName}</strong>
                  <small>Blackboard source identifier</small>
                </div>
                <div className={styles.mappingTarget}>
                  <Link href="/school" className={styles.courseBadge}>
                    <span
                      className={styles.courseBadgeDot}
                      style={{ background: m.course.color ?? "var(--accent)" }}
                      aria-hidden="true"
                    />
                    {m.course.code} · {m.course.name}
                  </Link>
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    title="Remove mapping"
                    disabled={pending}
                    onClick={() => run(() => deleteCourseMappingAction(m.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyState}>No course mappings saved yet.</p>
        )}

        {status.courses.length > 0 ? (
          <form className={styles.form} onSubmit={handleSaveMapping}>
            <div className={styles.twoCol}>
              <label className={styles.field}>
                Source Course String
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. CS101 or 2026-CS-101"
                  value={newSourceCourse}
                  onChange={(e) => setNewSourceCourse(e.target.value)}
                  required
                />
              </label>
              <label className={styles.field}>
                Target Redline Course
                <select
                  className={styles.select}
                  value={newTargetCourseId}
                  onChange={(e) => setNewTargetCourseId(e.target.value)}
                  required
                >
                  {status.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className={styles.buttonSecondary}
              type="submit"
              disabled={pending || !newSourceCourse.trim()}
            >
              <Plus size={16} /> Save New Mapping
            </button>
          </form>
        ) : (
          <p className={styles.warning}>
            Add courses in <Link href="/school">School</Link> before setting up mappings.
          </p>
        )}
      </Surface>

      {/* 3. Unresolved Blackboard Queue (Full Width) */}
      <Surface variant="glass" className={`${styles.card} ${styles.fullWidth}`}>
        <header>
          <Layers size={20} />
          <div>
            <p>Unresolved observations</p>
            <h2>
              {status.unassigned.length > 0
                ? `${status.unassigned.length} Unresolved ${status.unassigned.length === 1 ? "Item" : "Items"}`
                : "Queue Clear"}
            </h2>
          </div>
        </header>

        {status.unassigned.length > 0 ? (
          <div className={styles.unassignedQueue}>
            <p className={styles.copy}>
              These observations do not match a single canonical course. Map them explicitly;
              title similarity is never used as an automatic identity.
            </p>

            {status.courses.length > 0 ? (
              <form className={styles.batchBar} onSubmit={handleBatchAssign}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={
                      selectedRecordIds.size === status.unassigned.length &&
                      status.unassigned.length > 0
                    }
                    onChange={toggleSelectAll}
                  />
                  Select all ({status.unassigned.length})
                </label>

                <select
                  className={styles.select}
                  value={batchTargetCourseId}
                  onChange={(e) => setBatchTargetCourseId(e.target.value)}
                >
                  {status.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>

                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={rememberMapping}
                    onChange={(e) => setRememberMapping(e.target.checked)}
                  />
                  Remember mapping for future items
                </label>

                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={pending || selectedRecordIds.size === 0}
                >
                  Assign {selectedRecordIds.size > 0 ? `(${selectedRecordIds.size})` : ""}
                </button>
              </form>
            ) : null}

            <ul className={styles.unassignedList}>
              {status.unassigned.map((rec) => {
                const isSelected = selectedRecordIds.has(rec.id);
                return (
                  <li key={rec.id} className={styles.unassignedItem}>
                    <input
                      type="checkbox"
                      className={styles.itemCheckbox}
                      checked={isSelected}
                      onChange={() => toggleRecordSelection(rec.id)}
                    />
                    <div className={styles.itemDetails}>
                      <strong>{rec.title}</strong>
                      <div className={styles.itemMeta}>
                        {rec.sourceCourseName ? (
                          <span className={styles.sourceTag}>
                            Source: {rec.sourceCourseName}
                          </span>
                        ) : (
                          <span className={styles.sourceTag}>No source course</span>
                        )}
                        {rec.dueDate ? <span>Due: {rec.dueDate}</span> : null}
                        {rec.dueAt ? (
                          <span>At: {new Date(rec.dueAt).toLocaleTimeString()}</span>
                        ) : null}
                        {rec.proposalStatus ? (
                          <span>Proposal: {rec.proposalStatus}</span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className={styles.emptyState}>
            ✓ All synchronized Blackboard items have assigned courses.
          </p>
        )}
      </Surface>

      {/* 4. Sync Health */}
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
        {status.lastErrorCode ? (
          <p className={styles.warning}>Action required: {status.lastErrorCode}</p>
        ) : null}
        <ul className={styles.runs}>
          {status.runs.map((run) => (
            <li key={run.id}>
              <strong>{run.status}</strong>
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              <small>
                {run.created} new · {run.updated} updated · {run.missing} missing
              </small>
            </li>
          ))}
        </ul>
      </Surface>

      {/* 5. Notifications */}
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
