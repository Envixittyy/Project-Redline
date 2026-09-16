"use client";

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Layers,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Surface } from "@/components/ui/surface";
import { Select } from "@/components/ui/select";
import type {
  NotionAccountStatus,
  NotionPageLink,
  NotionSyncConflict,
  NotionSyncDirection,
} from "@/services/integrations/notion/types";

import {
  connectNotionAction,
  disconnectNotionAction,
  resolveNotionConflictAction,
  syncNoteAction,
  unlinkNoteAction,
  updateNotionLinkDirectionAction,
} from "./notion-actions";
import styles from "./notion-panel.module.css";

type NotionPanelProps = {
  status: NotionAccountStatus;
  links: NotionPageLink[];
  conflicts: NotionSyncConflict[];
  notes: Array<{ id: string; title: string }>;
};

export function NotionPanel({ status, links, conflicts, notes }: NotionPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await action();
      setMessage(res.message);
      router.refresh();
    });
  }

  const notesMap = new Map(notes.map((n) => [n.id, n.title]));

  return (
    <div className={styles.layout}>
      {/* Connection Card */}
      <Surface variant="glass" className={styles.card}>
        <header>
          <Layers size={20} />
          <div>
            <p>Notion Integration</p>
            <h2>{status.connected ? "Connected" : "Not connected"}</h2>
          </div>
          <Badge tone={status.connected ? "success" : "neutral"} size="sm">
            {status.connected ? "Connected" : "Disconnected"}
          </Badge>
        </header>

        <p className={styles.copy}>
          Connect an internal integration token to export and synchronize notes. Tokens are
          encrypted with AES-256-GCM and never exposed to the client.
        </p>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const token = data.get("token");
            const hint = data.get("hint");
            run(() => connectNotionAction(token, hint));
          }}
        >
          <label className={styles.field}>
            Integration Token (Internal secret)
            <input
              name="token"
              type="password"
              className={styles.input}
              placeholder="secret_..."
              required
              autoComplete="off"
            />
          </label>

          <label className={styles.field}>
            Workspace Label (Optional hint)
            <input
              name="hint"
              type="text"
              className={styles.input}
              placeholder={status.credentialHint || "My Workspace"}
              autoComplete="off"
            />
          </label>

          <div className={styles.actions}>
            <Button variant="primary" type="submit" loading={pending} disabled={pending}>
              {status.connected ? "Replace Token" : "Connect Notion"}
            </Button>
            {status.connected ? (
              <Button
                variant="destructive"
                type="button"
                disabled={pending}
                onClick={() => run(disconnectNotionAction)}
              >
                Disconnect
              </Button>
            ) : null}
          </div>
        </form>

        {message ? (
          <Callout tone="info" title="Status">
            {message}
          </Callout>
        ) : null}
      </Surface>

      {/* Conflicts Review */}
      {conflicts.length > 0 ? (
        <Surface variant="base" className={styles.card}>
          <header>
            <AlertCircle size={20} color="#f87171" />
            <div>
              <p>Action Required</p>
              <h2>Sync Conflicts ({conflicts.length})</h2>
            </div>
          </header>
          <p className={styles.copy}>
            Concurrent edits occurred on both Forward and Notion. Choose which version to retain:
          </p>

          <div className={styles.layout}>
            {conflicts.map((conflict) => (
              <div key={conflict.id} className={styles.conflictBox}>
                <div>
                  <strong>Note: {conflict.localSnapshot.title}</strong>
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                    Forward title: &ldquo;{conflict.localSnapshot.title}&rdquo; · Notion title: &ldquo;{conflict.remoteSnapshot.title}&rdquo;
                  </p>
                </div>
                <div className={styles.actions}>
                  <Button
                    variant="primary"
                    size="md"
                    disabled={pending}
                    onClick={() =>
                      run(() => resolveNotionConflictAction(conflict.id, "keep_redline"))
                    }
                  >
                    Keep Forward Version
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={pending}
                    onClick={() =>
                      run(() => resolveNotionConflictAction(conflict.id, "use_notion"))
                    }
                  >
                    Use Notion Version
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      {/* Linked Notes */}
      <Surface variant="base" className={styles.card}>
        <header>
          <CheckCircle2 size={20} />
          <div>
            <p>Synchronized Content</p>
            <h2>Linked Notes ({links.length})</h2>
          </div>
        </header>

        {links.length === 0 ? (
          <p className={styles.copy}>
            No notes are linked yet. Open any note in the Notes workspace to export or link it to Notion.
          </p>
        ) : (
          <ul className={styles.linksList}>
            {links.map((link) => {
              const noteTitle = notesMap.get(link.noteId) || link.baseSnapshot?.title || "Untitled Note";
              return (
                <li key={link.id} className={styles.linkItem}>
                  <div className={styles.linkInfo}>
                    <span className={styles.linkTitle}>
                      {noteTitle}
                      <a
                        href={link.remoteUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--text-secondary)" }}
                        title="Open in Notion"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </span>
                    <div className={styles.linkMeta}>
                      <Badge
                        tone={
                          link.status === "synced"
                            ? "success"
                            : link.status === "conflict"
                              ? "destructive"
                              : "warning"
                        }
                        size="sm"
                      >
                        {link.status.replace(/_/g, " ")}
                      </Badge>
                      <span>
                        Last sync:{" "}
                        {link.lastSuccessAt
                          ? new Date(link.lastSuccessAt).toLocaleString()
                          : "Never"}
                      </span>
                    </div>
                  </div>

                  <div className={styles.linkControls}>
                    <Select
                      disabled={pending}
                      value={link.direction}
                      onChange={(value) =>
                        run(() =>
                          updateNotionLinkDirectionAction(
                            link.noteId,
                            value as NotionSyncDirection,
                          ),
                        )
                      }
                      ariaLabel={`Sync direction for ${noteTitle}`}
                      options={[
                        { value: "forward_to_notion", label: "Export Only (Forward → Notion)" },
                        { value: "selective_two_way", label: "Two-Way (Forward ↔ Notion)" },
                      ]}
                    />

                    <Button
                      variant="secondary"
                      size="md"
                      disabled={pending || link.status === "syncing"}
                      type="button"
                      icon={<RefreshCw size={14} />}
                      onClick={() => run(() => syncNoteAction(link.noteId))}
                      title="Sync now"
                    >
                      Sync
                    </Button>

                    <IconButton
                      variant="ghost"
                      size="md"
                      disabled={pending}
                      aria-label="Unlink note"
                      icon={<Trash2 size={14} />}
                      onClick={() => run(() => unlinkNoteAction(link.noteId))}
                      title="Unlink"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Surface>
    </div>
  );
}
