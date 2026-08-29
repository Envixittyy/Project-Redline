import { describe, expect, it } from "vitest";

import { minimizeContext } from "./context-minimizer";

describe("Phase 9: AI Context Minimizer", () => {
  it("normalizes text and builds request-bound handles without internal IDs", () => {
    const result = minimizeContext({
      purpose: "Task Breakdown",
      prompt: "Break this assignment into subtasks",
      tasks: [
        {
          id: "task-uuid-111",
          title: "Write Research Paper",
          description: "Include at least 5 citations",
          dueAt: "2026-09-01T14:00:00Z",
          priority: "high",
        },
      ],
      notes: [
        {
          id: "note-uuid-222",
          title: "Paper Outline",
          body: "# Section 1\nIntro\n# Section 2\nBody",
        },
      ],
    });

    expect(result.envelope.version).toBe(1);
    expect(result.envelope.purpose).toBe("Task Breakdown");
    expect(result.envelope.items).toHaveLength(2);

    // Items have handles, not raw database UUIDs
    expect(result.envelope.items[0].handle).toBe("task_1");
    expect(result.envelope.items[0].title).toBe("Write Research Paper");
    expect("id" in result.envelope.items[0]).toBe(false);

    expect(result.envelope.items[1].handle).toBe("note_2");
    expect(result.envelope.items[1].title).toBe("Paper Outline");
    expect("id" in result.envelope.items[1]).toBe(false);

    // Handle map preserves domain mapping server-side
    expect(result.handleMap["task_1"]).toEqual({
      entityType: "task",
      entityId: "task-uuid-111",
    });
    expect(result.handleMap["note_2"]).toEqual({
      entityType: "note",
      entityId: "note-uuid-222",
    });

    expect(result.allowListedFields).toContain("title");
    expect(result.allowListedFields).toContain("description");
    expect(result.allowListedFields).toContain("body");
    expect(result.totalByteCount).toBeGreaterThan(50);
  });

  it("enforces max source items limits", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
    }));

    const result = minimizeContext({
      purpose: "Planning",
      tasks,
    });

    expect(result.envelope.items.length).toBe(10);
  });
});
