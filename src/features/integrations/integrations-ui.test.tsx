import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("./blackboard-actions", () => ({
  assignBlackboardRecordsAction: vi.fn(),
  characterizeBlackboardAction: vi.fn(),
  configureBlackboardAction: vi.fn(),
  deleteCourseMappingAction: vi.fn(),
  saveCourseMappingAction: vi.fn(),
  syncBlackboardAction: vi.fn(),
}));
vi.mock("./notion-actions", () => ({
  connectNotionAction: vi.fn(),
  disconnectNotionAction: vi.fn(),
  resolveNotionConflictAction: vi.fn(),
  syncNoteAction: vi.fn(),
  unlinkNoteAction: vi.fn(),
  updateNotionLinkDirectionAction: vi.fn(),
}));

import { BlackboardPanel } from "./blackboard-panel";
import { NotionPanel } from "./notion-panel";

describe("Integrations UI Primitives", () => {
  describe("BlackboardPanel", () => {
    it("renders private feed configuration with S7 badges and buttons", () => {
      const html = renderToStaticMarkup(
        <BlackboardPanel
          status={{
            connected: true,
            accountId: "acc-1",
            credentialHint: "blackboard.example.edu",
            mode: "observe",
            syncState: "idle",
            lastSuccessAt: "2026-09-10T12:00:00Z",
            lastErrorCode: null,
            courses: [{ id: "c1", code: "CS 101", name: "Intro to CS", color: "#3b82f6" }],
            mappings: [],
            unassigned: [],
            runs: [],
            changes: [],
            notifications: [],
          }}
          pushConfigured={false}
        />
      );

      expect(html).toContain("Private iCalendar feed");
      expect(html).toContain("Connected");
      expect(html).toContain("Sync now");
      expect(html).toContain("Inspect redacted structure");
      expect(html).toContain("Deterministic course mapping");
      expect(html).toContain("All synchronized Blackboard items have assigned courses.");
    });

    it("renders unassigned queue with selection controls", () => {
      const html = renderToStaticMarkup(
        <BlackboardPanel
          status={{
            connected: true,
            accountId: "acc-1",
            credentialHint: "blackboard.example.edu",
            mode: "observe",
            syncState: "idle",
            lastSuccessAt: null,
            lastErrorCode: null,
            courses: [{ id: "c1", code: "CS 101", name: "Intro to CS", color: "#3b82f6" }],
            mappings: [],
            unassigned: [
              {
                id: "rec-1",
                accountId: "acc-1",
                externalUid: "ext-1",
                title: "Homework 3: Graph Traversal",
                description: null,
                sourceCourseName: "CS101-FALL",
                dueDate: "2026-09-15",
                dueAt: null,
                duePrecision: "date",
                sourceUrl: null,
                proposalId: null,
                proposalStatus: "pending",
              },
            ],
            runs: [],
            changes: [],
            notifications: [],
          }}
          pushConfigured={false}
        />
      );

      expect(html).toContain("1 Unresolved Item");
      expect(html).toContain("Homework 3: Graph Traversal");
      expect(html).toContain("Source: CS101-FALL");
      expect(html).toContain("Assign");
    });
  });

  describe("NotionPanel", () => {
    it("renders disconnected state with S7 connect button", () => {
      const html = renderToStaticMarkup(
        <NotionPanel
          status={{
            connected: false,
            accountId: null,
            credentialHint: null,
            syncState: "idle",
            lastSuccessAt: null,
            lastErrorCode: null,
            activeLinksCount: 0,
            conflictsCount: 0,
          }}
          links={[]}
          conflicts={[]}
          notes={[]}
        />
      );

      expect(html).toContain("Notion Integration");
      expect(html).toContain("Disconnected");
      expect(html).toContain("Connect Notion");
      expect(html).toContain("No notes are linked yet");
    });

    it("renders connected state with linked notes and sync controls", () => {
      const html = renderToStaticMarkup(
        <NotionPanel
          status={{
            connected: true,
            accountId: "notion-acc-1",
            credentialHint: "Personal Workspace",
            syncState: "synced",
            lastSuccessAt: "2026-09-10T12:00:00Z",
            lastErrorCode: null,
            activeLinksCount: 1,
            conflictsCount: 0,
          }}
          links={[
            {
              id: "link-1",
              userId: "user-1",
              accountId: "notion-acc-1",
              noteId: "note-1",
              workspaceId: "ws-1",
              remotePageId: "pg-1",
              remoteRootBlockId: null,
              remoteUrl: "https://notion.so/test",
              direction: "selective_two_way",
              converterVersion: 1,
              baseSnapshot: { version: 1, title: "Operating Systems Lecture", body: [] },
              baseLocalFingerprint: null,
              baseRemoteFingerprint: null,
              lastObservedLocalFingerprint: null,
              lastObservedRemoteFingerprint: null,
              lastPushedFingerprint: null,
              lastRemoteRevision: null,
              activeAttemptId: null,
              pendingAttemptId: null,
              pendingRootBlockId: null,
              status: "synced",
              lastErrorCode: null,
              lastAttemptAt: null,
              lastSuccessAt: "2026-09-10T12:00:00Z",
              retiredAt: null,
              createdAt: "2026-09-10T12:00:00Z",
              updatedAt: "2026-09-10T12:00:00Z",
            },
          ]}
          conflicts={[]}
          notes={[{ id: "note-1", title: "Operating Systems Lecture" }]}
        />
      );

      expect(html).toContain("Personal Workspace");
      expect(html).toContain("Disconnect");
      expect(html).toContain("Operating Systems Lecture");
      expect(html).toContain("synced");
      expect(html).toContain("Sync");
    });
  });
});
