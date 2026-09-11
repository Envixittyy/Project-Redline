import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(() => null),
  }),
}));
vi.mock("./capture-actions", () => ({
  commitCaptureTaskAction: vi.fn(async () => ({ ok: true })),
  dismissProposalAction: vi.fn(async () => ({ ok: true })),
  prepareCaptureTaskAction: vi.fn(async () => ({ ok: true })),
  undoCaptureTaskAction: vi.fn(async () => ({ ok: true })),
  acknowledgeProposalDivergenceAction: vi.fn(async () => ({ ok: true })),
}));

import { CaptureInbox, type CaptureInboxViewItem } from "./capture-inbox";

describe("CaptureInbox UI", () => {
  const sampleItems: CaptureInboxViewItem[] = [
    {
      id: "cap-1",
      capturedAt: "2026-09-10T12:00:00Z",
      stage: "proposed",
      content: { kind: "text", text: "Read Chapter 4 Biology" },
      interpretationId: "int-1",
      operationBatchId: null,
      errorCode: null,
      proposal: {
        id: "prop-1",
        captureId: "cap-1",
        action: "create_task",
        status: "proposed",
        title: "Read Chapter 4 Biology",
        description: null,
        dueDate: "2026-09-12",
        dueAt: null,
        courseId: null,
        external: null,
        createdAt: "2026-09-10T12:00:00Z",
      },
      undoExpiresAt: null,
      capturedLabel: "Sep 10, 12:00 PM",
      canUndo: false,
    },
    {
      id: "cap-2",
      capturedAt: "2026-09-10T11:00:00Z",
      stage: "committed",
      content: { kind: "text", text: "Physics assignment 2" },
      interpretationId: null,
      operationBatchId: "batch-1",
      errorCode: null,
      proposal: null,
      undoExpiresAt: "2026-09-10T11:10:00Z",
      capturedLabel: "Sep 10, 11:00 AM",
      canUndo: true,
    },
  ];

  it("renders triage queue tabs with counts", () => {
    const html = renderToStaticMarkup(<CaptureInbox items={sampleItems} />);
    expect(html).toContain("Needs Review (1)");
    expect(html).toContain("Committed (1)");
    expect(html).toContain("All (2)");
  });

  it("renders proposed item with action buttons in Needs Review tab", () => {
    const html = renderToStaticMarkup(<CaptureInbox items={sampleItems} />);
    expect(html).toContain("Read Chapter 4 Biology");
    expect(html).toContain("Add to Tasks");
    expect(html).toContain("Dismiss");
  });

  it("renders empty state when there are no items", () => {
    const html = renderToStaticMarkup(<CaptureInbox items={[]} />);
    expect(html).toContain("Your Inbox is clear");
  });
});
