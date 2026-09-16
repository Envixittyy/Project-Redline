"use client";

import {
  Archive,
  ArrowLeft,
  ExternalLink,
  FileText,
  Layers,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { enqueueOfflineMutation } from "@/lib/offline/queue";
import type { Course } from "@/types/course";
import type { Attachment, Note } from "@/types/note";

import { getTaskLinkOptionsAction } from "@/features/tasks/task-actions";
import {
  exportNoteToNotionAction,
  getNotionIntegrationDataAction,
  syncNoteAction,
} from "@/features/integrations/notion-actions";
import type { NotionPageLink } from "@/services/integrations/notion/types";

import { archiveNoteAction, saveNoteAction } from "./note-actions";
import { MarkdownPreview } from "./markdown-preview";
import { NoteAiDialog } from "./note-ai-dialog";
import styles from "./note-workspace.module.css";

type TaskOption = { id: string; title: string };

export function NoteWorkspace({
  notes,
  courses,
  tasks: initialTasks = [],
  initialSearch,
  notionConnected: initialNotionConnected = false,
  notionLinks: initialNotionLinks = [],
}: {
  notes: Note[];
  courses: Course[];
  tasks?: TaskOption[];
  initialSearch: string;
  notionConnected?: boolean;
  notionLinks?: NotionPageLink[];
}) {
  const router = useRouter();
  const [deferredTasks, setDeferredTasks] = useState<TaskOption[] | null>(null);
  const tasks = initialTasks.length > 0 ? initialTasks : (deferredTasks ?? []);

  const [deferredNotion, setDeferredNotion] = useState<{
    connected: boolean;
    links: NotionPageLink[];
  } | null>(null);

  const notionConnected = initialNotionConnected || (deferredNotion?.connected ?? false);
  const notionLinks = initialNotionLinks.length > 0 ? initialNotionLinks : (deferredNotion?.links ?? []);

  // Keep Notion data out of the critical path: check in background after initial render
  useEffect(() => {
    if (!initialNotionConnected && initialNotionLinks.length === 0) {
      let active = true;
      getNotionIntegrationDataAction().then((data) => {
        if (active && data.connected) {
          setDeferredNotion(data);
        }
      });
      return () => {
        active = false;
      };
    }
  }, [initialNotionConnected, initialNotionLinks.length]);

  const handleOpenTaskSelect = useCallback(() => {
    if (deferredTasks !== null || initialTasks.length > 0) return;
    getTaskLinkOptionsAction().then((loaded) => {
      setDeferredTasks(loaded);
    });
  }, [deferredTasks, initialTasks.length]);

  const [selectedId, setSelectedId] = useState<string | null>(notes[0]?.id ?? null);
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  const [draft, setDraft] = useState<{
    title: string;
    body: string;
    taskId: string | null;
    courseId: string | null;
  }>(() => selected ?? { title: "", body: "", taskId: null, courseId: null });

  const [status, setStatus] = useState<"Synced" | "Pending" | "Saving" | "Failed">("Synced");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showAiModal, setShowAiModal] = useState(false);

  // Responsive mobile view state
  const [mobileView, setMobileView] = useState<"list" | "editor">(() =>
    selected ? "editor" : "list",
  );

  // Writing vs Preview mode
  const [viewMode, setViewMode] = useState<"write" | "preview" | "split">("write");

  // Filter notes client-side if needed for search
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const filteredNotes = searchQuery.trim()
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.body.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : notes;

  // Debounced autosave
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(async () => {
      const payload = {
        id: selectedId,
        title: draft.title,
        body: draft.body,
        taskId: draft.taskId,
        courseId: draft.courseId,
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

  // Load attachments when note changes
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!selectedId) {
        if (active) setAttachments([]);
        return;
      }
      try {
        const response = await fetch(`/api/attachments?noteId=${encodeURIComponent(selectedId)}`, {
          cache: "no-store",
        });
        const next = response.ok ? await response.json() : [];
        if (active) setAttachments(next);
      } catch {
        if (active) setAttachments([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const updateDraft = (patch: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus("Pending");
  };

  const choose = (id: string) => {
    const note = notes.find((item) => item.id === id);
    if (note) setDraft(note);
    setSelectedId(id);
    setMessage(null);
    setStatus("Synced");
    setMobileView("editor");
  };

  const save = () =>
    startTransition(async () => {
      const operationId = crypto.randomUUID();
      const payload = {
        title: draft.title || "Untitled note",
        body: draft.body,
        taskId: draft.taskId,
        courseId: draft.courseId,
        operationId,
      };
      if (!navigator.onLine) {
        await enqueueOfflineMutation({
          id: operationId,
          kind: selectedId ? "note_update" : "note_create",
          payload: selectedId ? { ...payload, id: selectedId } : payload,
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
          payload: selectedId ? { ...payload, id: selectedId } : payload,
        });
        setStatus("Pending");
        setMessage("Connection lost. This note is pending synchronization.");
      }
    });

  const create = () => {
    setSelectedId(null);
    setDraft({ title: "Untitled note", body: "", taskId: null, courseId: null });
    setAttachments([]);
    setStatus("Pending");
    setMobileView("editor");
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
      await fetch(`/api/attachments?noteId=${encodeURIComponent(selectedId)}`, {
        cache: "no-store",
      }).then((r) => r.json()),
    );
  };

  const renameAttachment = async (file: Attachment) => {
    const fileName = window.prompt("Rename attachment", file.fileName)?.trim();
    if (!fileName || fileName === file.fileName) return;
    const response = await fetch(`/api/attachments/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName }),
    });
    if (response.ok)
      setAttachments((current) =>
        current.map((item) => (item.id === file.id ? { ...item, fileName } : item)),
      );
    else setMessage("The attachment could not be renamed.");
  };

  const deleteAttachment = async (file: Attachment) => {
    if (!window.confirm(`Delete ${file.fileName}?`)) return;
    const response = await fetch(`/api/attachments/${file.id}`, { method: "DELETE" });
    if (response.ok)
      setAttachments((current) => current.filter((item) => item.id !== file.id));
    else setMessage("The attachment could not be deleted.");
  };

  const activeLink = selectedId
    ? notionLinks.find((l) => l.noteId === selectedId) ?? null
    : null;

  return (
    <div className={styles.workspaceContainer}>
      <div
        className={styles.pageHeaderWrap}
        data-mobile-editor={mobileView === "editor" ? "true" : undefined}
      >
        <PageHeader
          title="Notes"
          description="Private Markdown notes with reliable saving, task and course links, search, and authenticated attachments."
        />
      </div>

      <div className={styles.layout} data-mobile-view={mobileView}>
        {/* Sidebar: Note List & Search */}
      <aside className={styles.sidebar} aria-label="Notes directory">
        <div className={styles.sidebarHeader}>
          <form
            action="/notes"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/notes?q=${encodeURIComponent(searchQuery)}`);
            }}
          >
            <SearchInput
              name="q"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
            />
          </form>
          <Button
            variant="primary"
            size="md"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={create}
            style={{ width: "100%" }}
          >
            New note
          </Button>
        </div>

        <ul className={styles.noteList} role="list">
          {filteredNotes.length > 0 ? (
            filteredNotes.map((note) => {
              const isActive = note.id === selectedId;
              return (
                <li key={note.id} className={styles.noteItem}>
                  <button
                    type="button"
                    className={styles.noteButton}
                    data-active={isActive ? "true" : undefined}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => choose(note.id)}
                  >
                    <span className={styles.noteTitle}>{note.title || "Untitled note"}</span>
                    <span className={styles.noteDate}>
                      {new Date(note.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className={styles.emptyNotes}>
              {notes.length === 0 ? "No notes yet. Create your first note above." : "No notes match your search."}
            </li>
          )}
        </ul>
      </aside>

      {/* Editor Canvas */}
      <main className={styles.editor}>
        <header className={styles.editorHeader}>
          <div className={styles.headerLeft}>
            <button
              type="button"
              className={styles.backToListButton}
              onClick={() => setMobileView("list")}
              aria-label="Back to notes list"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Notes</span>
            </button>
            <span className={styles.editorStatus} data-status={status}>
              {status === "Synced" ? "Saved" : status}
            </span>
          </div>

          <div className={styles.headerActions}>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={14} aria-hidden="true" />}
              disabled={pending}
              onClick={save}
            >
              Save
            </Button>
            {selected ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Archive size={14} aria-hidden="true" />}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await archiveNoteAction(selected.id);
                    if (result.ok) {
                      setSelectedId(null);
                      setMobileView("list");
                      router.refresh();
                    } else setMessage(result.message);
                  })
                }
              >
                Archive
              </Button>
            ) : null}
            {selected ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Sparkles size={14} aria-hidden="true" />}
                disabled={pending}
                onClick={() => setShowAiModal(true)}
              >
                AI Assist
              </Button>
            ) : null}
          </div>
        </header>

        {/* AI Modal Dialog */}
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

        {/* Notion Integration Bar */}
        {selected && notionConnected ? (
          <div className={styles.notionBar}>
            <div className={styles.notionLeft}>
              <Layers size={16} aria-hidden="true" />
              <span>Notion</span>
              {activeLink ? (
                <>
                  <Badge
                    tone={
                      activeLink.status === "synced"
                        ? "success"
                        : activeLink.status === "conflict"
                        ? "destructive"
                        : "warning"
                    }
                    size="sm"
                  >
                    {activeLink.status.replace(/_/g, " ")}
                  </Badge>
                  <a
                    href={activeLink.remoteUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in Notion"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </>
              ) : (
                <Badge tone="neutral" size="sm">
                  Not linked
                </Badge>
              )}
            </div>

            <div className={styles.notionRight}>
              {activeLink ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={13} aria-hidden="true" />}
                  disabled={pending || activeLink.status === "syncing"}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await syncNoteAction(selected.id);
                      setMessage(res.message);
                      router.refresh();
                    })
                  }
                >
                  Sync
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const parentPageId = window
                      .prompt("Enter target Notion Parent Page ID:")
                      ?.trim();
                    if (!parentPageId) return;
                    startTransition(async () => {
                      const res = await exportNoteToNotionAction(selected.id, parentPageId);
                      setMessage(res.message);
                      router.refresh();
                    });
                  }}
                >
                  Export to Notion
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {/* Message / Error */}
        {message ? (
          <Callout variant="error" role="alert">
            {message}
          </Callout>
        ) : null}

        {/* Title Input */}
        <div className={styles.titleGroup}>
          <input
            className={styles.titleInput}
            value={draft.title}
            maxLength={200}
            placeholder="Note title…"
            aria-label="Note title"
            onChange={(event) => updateDraft({ title: event.target.value })}
          />
        </div>

        {/* Metadata Bar (Task & Course Links) */}
        <div className={styles.metaBar}>
          <div className={styles.metaSelectGroup}>
            <label className={styles.metaLabel} htmlFor="note-task-select">
              Linked Task
            </label>
            <Select
              id="note-task-select"
              value={draft.taskId ?? ""}
              onChange={(value) => updateDraft({ taskId: value || null })}
              onOpen={handleOpenTaskSelect}
              options={[
                { value: "", label: "No linked task" },
                ...tasks.map((task) => ({ value: task.id, label: task.title })),
              ]}
            />
          </div>

          <div className={styles.metaSelectGroup}>
            <label className={styles.metaLabel} htmlFor="note-course-select">
              Linked Course
            </label>
            <Select
              id="note-course-select"
              value={draft.courseId ?? ""}
              onChange={(value) => updateDraft({ courseId: value || null })}
              options={[
                { value: "", label: "No linked course" },
                ...courses.map((course) => ({
                  value: course.id,
                  label: `${course.code} · ${course.name}`,
                })),
              ]}
            />
          </div>
        </div>

        {/* View Selector Bar: Write / Preview / Split */}
        <div className={styles.viewSelectorBar}>
          <SegmentedControl
            value={viewMode}
            onChange={(val) => setViewMode(val as "write" | "preview" | "split")}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
              { value: "split", label: "Split" },
            ]}
          />
        </div>

        {/* Content Canvas */}
        <div className={styles.canvasArea} data-split={viewMode === "split" ? "true" : undefined}>
          {(viewMode === "write" || viewMode === "split") && (
            <textarea
              className={styles.textarea}
              value={draft.body}
              placeholder={`# Study notes

- Key points
- Important concepts`}
              aria-label="Note markdown body"
              onChange={(event) => updateDraft({ body: event.target.value })}
            />
          )}

          {(viewMode === "preview" || viewMode === "split") && (
            <section
              className={styles.previewContainer}
              aria-label="Markdown formatted preview"
            >
              <MarkdownPreview source={draft.body} />
            </section>
          )}
        </div>

        {/* Attachments Section */}
        <section className={styles.attachmentsSection} aria-label="Attachments">
          <div className={styles.attachmentsHeader}>
            <h3>Private Attachments ({attachments.length})</h3>
            <Button
              variant="secondary"
              size="sm"
              icon={<Paperclip size={14} aria-hidden="true" />}
              onClick={() => fileRef.current?.click()}
            >
              Upload
            </Button>
            <input
              ref={fileRef}
              hidden
              type="file"
              aria-label="Upload note attachment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
          </div>

          {attachments.length > 0 ? (
            <ul className={styles.attachmentList} role="list">
              {attachments.map((file) => (
                <li key={file.id} className={styles.attachmentItem}>
                  <FileText size={15} aria-hidden="true" style={{ color: "var(--text-secondary)" }} />
                  <a href={`/api/attachments/${file.id}`}>{file.fileName}</a>
                  <span className={styles.attachmentSize}>
                    {Math.ceil(file.sizeBytes / 1024)} KB
                  </span>
                  <button
                    type="button"
                    className={styles.attachmentActionBtn}
                    aria-label={`Rename ${file.fileName}`}
                    onClick={() => void renameAttachment(file)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.attachmentActionBtn}
                    aria-label={`Delete ${file.fileName}`}
                    onClick={() => void deleteAttachment(file)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
              No attachments on this note.
            </p>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}
