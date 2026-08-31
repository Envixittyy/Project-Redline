"use client";

import { Archive, FileText, Paperclip, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Surface } from "@/components/ui/surface";
import { enqueueOfflineMutation } from "@/lib/offline/queue";
import type { Course } from "@/types/course";
import type { Attachment, Note } from "@/types/note";

import {
  exportNoteToNotionAction,
  syncNoteAction,
} from "@/features/integrations/notion-actions";
import type { NotionPageLink } from "@/services/integrations/notion/types";
import { ExternalLink, Layers, RefreshCw, Sparkles } from "lucide-react";

import { archiveNoteAction, saveNoteAction } from "./note-actions";
import { MarkdownPreview } from "./markdown-preview";
import { NoteAiDialog } from "./note-ai-dialog";
import styles from "./note-workspace.module.css";

type TaskOption = { id: string; title: string };
export function NoteWorkspace({
  notes,
  courses,
  tasks,
  initialSearch,
  notionConnected = false,
  notionLinks = [],
}: {
  notes: Note[];
  courses: Course[];
  tasks: TaskOption[];
  initialSearch: string;
  notionConnected?: boolean;
  notionLinks?: NotionPageLink[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(notes[0]?.id ?? null);
  const selected = notes.find(note => note.id === selectedId) ?? null;
  const [draft, setDraft] = useState<{ title: string; body: string; taskId: string | null; courseId: string | null }>(
    () => selected ?? { title: "", body: "", taskId: null, courseId: null }
  );
  const [status, setStatus] = useState<"Synced" | "Pending" | "Saving" | "Failed">("Synced");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(async () => {
      const payload = {
        id: selectedId,
        title: draft.title,
        body: draft.body,
        taskId: draft.taskId,
        courseId: draft.courseId
      };
      if (!navigator.onLine) {
        await enqueueOfflineMutation({ id: crypto.randomUUID(), kind: "note_update", payload });
        setStatus("Pending");
        return;
      }
      setStatus("Saving");
      try {
        const result = await saveNoteAction(selectedId, payload);
        if (result.ok) {
          setStatus("Synced");
          router.refresh();
        } else {
          setStatus("Failed");
          setMessage(result.message);
        }
      } catch {
        await enqueueOfflineMutation({ id: crypto.randomUUID(), kind: "note_update", payload });
        setStatus("Pending");
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draft.title, draft.body, draft.taskId, draft.courseId, selectedId, router]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!selectedId) {
        if (active) setAttachments([]);
        return;
      }
      try {
        const response = await fetch(`/api/attachments?noteId=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
        const next = response.ok ? await response.json() : [];
        if (active) setAttachments(next);
      } catch {
        if (active) setAttachments([]);
      }
    };
    void load();
    return () => {
      active = false
    };
  }, [selectedId]);
  const updateDraft = (patch: Partial<typeof draft>) => {
    setDraft(current => ({ ...current, ...patch }));
    setStatus("Pending")
  };
  const choose = (id: string) => {
    const note = notes.find(item => item.id === id);
    if (note) setDraft(note);
    setSelectedId(id);
    setMessage(null);
    setStatus("Synced")
  };
  const save = () => startTransition(async () => {
    const operationId = crypto.randomUUID();
    const payload = {
      title: draft.title || "Untitled note",
      body: draft.body,
      taskId: draft.taskId,
      courseId: draft.courseId,
      operationId
    };
    if (!navigator.onLine) {
      await enqueueOfflineMutation({
        id: operationId,
        kind: selectedId ? "note_update" : "note_create",
        payload: selectedId ? { ...payload, id: selectedId } : payload
      });
      setStatus("Pending");
      setMessage("Saved offline. This note is pending synchronization.");
      return;
    }
    try {
      const result = await saveNoteAction(selectedId, payload);
      if (result.ok) {
        setStatus("Synced");
        setSelectedId(result.id ?? selectedId);
        router.refresh();
      } else {
        setStatus("Failed");
        setMessage(result.message);
      }
    } catch {
      await enqueueOfflineMutation({
        id: operationId,
        kind: selectedId ? "note_update" : "note_create",
        payload: selectedId ? { ...payload, id: selectedId } : payload
      });
      setStatus("Pending");
      setMessage("Connection lost. This note is pending synchronization.");
    }
  });
  const create = () => {
    setSelectedId(null);
    setDraft({ title: "Untitled note", body: "", taskId: null, courseId: null });
    setAttachments([]);
    setStatus("Pending")
  };
  const upload = async (file: File) => {
    if (!selectedId) {
      setMessage("Save the note before adding an attachment.");
      return;
    }
    const data = new FormData();
    data.set("noteId", selectedId);
    data.set("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body: data });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Upload failed." }));
      setMessage(body.message);
      return;
    }
    setAttachments(
      await fetch(`/api/attachments?noteId=${encodeURIComponent(selectedId)}`, { cache: "no-store" }).then(r => r.json())
    );
  };
  const renameAttachment = async (file: Attachment) => {
    const fileName = window.prompt("Rename attachment", file.fileName)?.trim();
    if (!fileName || fileName === file.fileName) return;
    const response = await fetch(`/api/attachments/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName })
    });
    if (response.ok)
      setAttachments(current => current.map(item => item.id === file.id ? { ...item, fileName } : item));
    else setMessage("The attachment could not be renamed.");
  };
  const deleteAttachment = async (file: Attachment) => {
    if (!window.confirm(`Delete ${file.fileName}?`)) return;
    const response = await fetch(`/api/attachments/${file.id}`, { method: "DELETE" });
    if (response.ok) setAttachments(current => current.filter(item => item.id !== file.id));
    else setMessage("The attachment could not be deleted.");
  };
  const activeLink = selectedId ? notionLinks.find((l) => l.noteId === selectedId) ?? null : null;

  return <div className={styles.layout}>
    <aside className={styles.sidebar}>
      <form action="/notes" className={styles.search}>
        <Search size={16} />
        <input name="q" defaultValue={initialSearch} placeholder="Search notes" />
      </form>
      <button className={styles.newButton} type="button" onClick={create}>
        <Plus size={16} />
        New note
      </button>
      <ul>
        {notes.map(note => <li key={note.id}>
          <button type="button" data-active={note.id === selectedId || undefined} onClick={() => choose(note.id)}>
            <strong>{note.title}</strong>
            <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
          </button>
        </li>)}
      </ul>
    </aside>
    <Surface variant="base" className={styles.editor}>
      <header>
        <div>
          <span data-status={status}>{status}</span>
          <h2>{selected ? "Edit note" : "New note"}</h2>
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={pending} onClick={save}>
            <Save size={16} />
            Save
          </button>
          {selected ? <button
            type="button"
            onClick={() => startTransition(async () => {
              const result = await archiveNoteAction(selected.id);
              if (result.ok) {
                setSelectedId(null);
                router.refresh();
              } else setMessage(result.message);
            })}
          >
            <Archive size={16} />
            Archive
          </button> : null}
          {selected ? (
            <button type="button" disabled={pending} onClick={() => setShowAiModal(true)}>
              <Sparkles size={16} />
              AI Assist
            </button>
          ) : null}
        </div>
      </header>

      {showAiModal && selected ? (
        <NoteAiDialog
          note={{ id: selected.id, title: draft.title, body: draft.body }}
          onClose={() => setShowAiModal(false)}
          onNoteUpdated={(newBody) => {
            setDraft((prev) => ({ ...prev, body: newBody }));
            router.refresh();
          }}
        />
      ) : null}

      {selected && notionConnected ? (
        <div className={styles.notionBar}>
          <div className={styles.notionInfo}>
            <Layers size={16} />
            <span>Notion</span>
            {activeLink ? (
              <>
                <span className={styles.notionBadge} data-status={activeLink.status}>
                  {activeLink.status.replace(/_/g, " ")}
                </span>
                <a
                  href={activeLink.remoteUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in Notion"
                  style={{ display: "inline-flex", alignItems: "center", color: "var(--text-secondary)" }}
                >
                  <ExternalLink size={14} />
                </a>
              </>
            ) : (
              <span style={{ color: "var(--text-secondary)" }}>Not linked</span>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {activeLink ? (
              <button
                type="button"
                disabled={pending || activeLink.status === "syncing"}
                onClick={() =>
                  startTransition(async () => {
                    const res = await syncNoteAction(selected.id);
                    setMessage(res.message);
                    router.refresh();
                  })
                }
              >
                <RefreshCw size={14} />
                Sync
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const parentPageId = window.prompt("Enter target Notion Parent Page ID:")?.trim();
                  if (!parentPageId) return;
                  startTransition(async () => {
                    const res = await exportNoteToNotionAction(selected.id, parentPageId);
                    setMessage(res.message);
                    router.refresh();
                  });
                }}
              >
                Export to Notion
              </button>
            )}
          </div>
        </div>
      ) : null}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      <div className={styles.fields}>
        <label>
          Title
          <input value={draft.title} maxLength={200} onChange={event => updateDraft({ title: event.target.value })} />
        </label>
        <div className={styles.links}>
          <label>
            Task
            <select value={draft.taskId ?? ""} onChange={event => updateDraft({ taskId: event.target.value || null })}>
              <option value="">No linked task</option>
              {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
          <label>
            Course
            <select value={draft.courseId ?? ""} onChange={event => updateDraft({ courseId: event.target.value || null })}>
              <option value="">No linked course</option>
              {courses.map(course => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}
            </select>
          </label>
        </div>
        <label>
          Markdown
          <textarea
            value={draft.body}
            onChange={event => updateDraft({ body: event.target.value })}
            placeholder="# Study notes\n\n- Key idea"
          />
        </label>
      </div>
      <section className={styles.preview} aria-label="Markdown preview">
        <h3>Preview</h3>
        <MarkdownPreview source={draft.body} />
      </section>
      <section className={styles.attachments}>
        <div>
          <h3>Private attachments</h3>
          <button type="button" onClick={() => fileRef.current?.click()}>
            <Paperclip size={15} />
            Upload
          </button>
          <input
            ref={fileRef}
            hidden
            type="file"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
        {attachments.length ? <ul>
          {attachments.map(file => <li key={file.id}>
            <FileText size={15} />
            <a href={`/api/attachments/${file.id}`}>{file.fileName}</a>
            <span>{Math.ceil(file.sizeBytes / 1024)} KB</span>
            <button type="button" aria-label={`Rename ${file.fileName}`} onClick={() => void renameAttachment(file)}>
              <Pencil size={14} />
            </button>
            <button type="button" aria-label={`Delete ${file.fileName}`} onClick={() => void deleteAttachment(file)}>
              <Trash2 size={14} />
            </button>
          </li>)}
        </ul> : <p>No attachments.</p>}
      </section>
    </Surface>
  </div>;
}
