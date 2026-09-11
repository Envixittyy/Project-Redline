import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock server-only modules
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("./note-actions", () => ({
  saveNoteAction: vi.fn(async () => ({ ok: true })),
  archiveNoteAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/features/integrations/notion-actions", () => ({
  exportNoteToNotionAction: vi.fn(async () => ({ ok: true, message: "Exported" })),
  syncNoteAction: vi.fn(async () => ({ ok: true, message: "Synced" })),
}));

import { NoteWorkspace } from "./note-workspace";

describe("NoteWorkspace UI", () => {
  const sampleNotes = [
    {
      id: "note-1",
      userId: "user-1",
      title: "Biology 101 Lecture",
      body: "# Chapter 1\n\nCellular respiration overview.",
      taskId: null,
      courseId: null,
      createdAt: "2026-09-10T10:00:00Z",
      updatedAt: "2026-09-10T10:00:00Z",
      archivedAt: null,
    },
    {
      id: "note-2",
      userId: "user-1",
      title: "Chemistry Lab Prep",
      body: "Safety rules and reagent list.",
      taskId: null,
      courseId: null,
      createdAt: "2026-09-09T10:00:00Z",
      updatedAt: "2026-09-09T10:00:00Z",
      archivedAt: null,
    },
  ];

  it("renders notes list in sidebar with correct titles", () => {
    const html = renderToStaticMarkup(
      <NoteWorkspace
        notes={sampleNotes}
        courses={[]}
        tasks={[]}
        initialSearch=""
      />
    );
    expect(html).toContain("Biology 101 Lecture");
    expect(html).toContain("Chemistry Lab Prep");
    expect(html).toContain("New note");
  });

  it("renders active note editor canvas with save and archive actions", () => {
    const html = renderToStaticMarkup(
      <NoteWorkspace
        notes={sampleNotes}
        courses={[]}
        tasks={[]}
        initialSearch=""
      />
    );
    expect(html).toContain("Save");
    expect(html).toContain("Archive");
    expect(html).toContain("AI Assist");
    expect(html).toContain("Cellular respiration overview.");
  });

  it("renders view mode switcher with Write, Preview, Split", () => {
    const html = renderToStaticMarkup(
      <NoteWorkspace
        notes={sampleNotes}
        courses={[]}
        tasks={[]}
        initialSearch=""
      />
    );
    expect(html).toContain("Write");
    expect(html).toContain("Preview");
    expect(html).toContain("Split");
  });
});
