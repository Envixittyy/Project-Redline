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
  mapBlackboardEmailCourseAction: vi.fn(),
  retryBlackboardEmailAction: vi.fn(),
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
    it("renders active email ingestion status with counts and recent activity", () => {
      const html = renderToStaticMarkup(
        <BlackboardPanel
          status={{
            configured: true,
            courses: [{ id: "c1", code: "CS 101", name: "Intro to CS", color: "#3b82f6" }],
            courseMappingIssues: [],
            recentEvents: [
              {
                id: "evt-1",
                status: "processed",
                itemId: "item-1",
                courseId: "c1",
                receivedAt: "2026-09-10T12:00:00Z",
                parsedEvent: {
                  source: "blackboard",
                  messageKey: "msg-1",
                  provider: "resend",
                  sourceMessageId: "mid-1",
                  receivedAt: "2026-09-10T12:00:00Z",
                  sourceAt: null,
                  parserVersion: "blackboard-email-v1",
                  status: "parsed",
                  notificationType: "assignment",
                  itemType: "assignment",
                  courseHint: "CS 101",
                  baseCourseCode: "CS101",
                  courseKey: "CS101-FALL",
                  title: "Lab 1",
                  titleKey: "lab 1",
                  sourceKey: "src-1",
                  sourceUrl: null,
                  dueDate: "2026-09-15",
                  dueAt: null,
                  duePrecision: "date",
                  weight: null,
                  evidence: null,
                  reason: null,
                },
              },
            ],
            eventCounts: {
              total: 5,
              processed: 5,
              unresolved: 0,
              ignored: 0,
              other: 0,
            },
            latestEvent: {
              receivedAt: "2026-09-10T12:00:00Z",
              status: "processed",
              title: "Lab 1",
              itemType: "assignment",
            },
          }}
        />
      );

      expect(html).toContain("Notification Ingestion");
      expect(html).toContain("Ingestion active");
      expect(html).toContain("Automatic school updates from Blackboard notification emails");
      expect(html).toContain("Total: 5");
      expect(html).toContain("Processed: 5");
      expect(html).toContain("Lab 1");
    });

    it("renders unresolved events requiring course mapping resolution", () => {
      const html = renderToStaticMarkup(
        <BlackboardPanel
          status={{
            configured: true,
            courses: [{ id: "c1", code: "CS 101", name: "Intro to CS", color: "#3b82f6" }],
            courseMappingIssues: [
              {
                id: "evt-2",
                status: "unresolved_course",
                itemId: null,
                courseId: null,
                receivedAt: "2026-09-15T10:00:00Z",
                parsedEvent: {
                  source: "blackboard",
                  messageKey: "msg-2",
                  provider: "resend",
                  sourceMessageId: "mid-2",
                  receivedAt: "2026-09-15T10:00:00Z",
                  sourceAt: null,
                  parserVersion: "blackboard-email-v1",
                  status: "parsed",
                  notificationType: "assignment",
                  itemType: "assignment",
                  courseHint: "CS 101 - Intro to Programming",
                  baseCourseCode: "CS101",
                  courseKey: "CS101-FALL",
                  title: "Problem Set 2",
                  titleKey: "problem set 2",
                  sourceKey: "src-2",
                  sourceUrl: null,
                  dueDate: "2026-09-20",
                  dueAt: null,
                  duePrecision: "date",
                  weight: null,
                  evidence: null,
                  reason: null,
                },
              },
            ],
            recentEvents: [],
            eventCounts: {
              total: 1,
              processed: 0,
              unresolved: 1,
              ignored: 0,
              other: 0,
            },
            latestEvent: {
              receivedAt: "2026-09-15T10:00:00Z",
              status: "unresolved_course",
              title: "Problem Set 2",
              itemType: "assignment",
            },
          }}
        />
      );

      expect(html).toContain("Course Mapping Issue");
      expect(html).toContain("Problem Set 2");
      expect(html).toContain("CS101-FALL");
      expect(html).toContain("Map &amp; Retry");
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
