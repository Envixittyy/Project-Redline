import { describe, expect, it } from "vitest";

import { computePayloadDigest, isValidDigest } from "./payload-digest";
import type { AiContextEnvelope } from "./types";

describe("Phase 9: Payload Digest Engine", () => {
  const sampleEnvelope: AiContextEnvelope = {
    version: 1,
    purpose: "Summarize",
    prompt: "Summarize this note",
    items: [
      {
        handle: "note_1",
        entityType: "note",
        title: "Meeting Notes",
        body: "Discussed roadmap and milestones.",
      },
    ],
    locale: "en-US",
    timeZone: "UTC",
  };

  it("computes deterministic 64-character SHA-256 hex digest", () => {
    const digest1 = computePayloadDigest(sampleEnvelope);
    const digest2 = computePayloadDigest(sampleEnvelope);

    expect(digest1).toBe(digest2);
    expect(digest1).toHaveLength(64);
    expect(isValidDigest(digest1)).toBe(true);
  });

  it("changes digest when any content or purpose field changes", () => {
    const originalDigest = computePayloadDigest(sampleEnvelope);

    const modifiedEnvelope: AiContextEnvelope = {
      ...sampleEnvelope,
      items: [
        {
          ...sampleEnvelope.items[0],
          body: "Discussed roadmap and milestones — edited.",
        },
      ],
    };

    const modifiedDigest = computePayloadDigest(modifiedEnvelope);
    expect(modifiedDigest).not.toBe(originalDigest);
  });
});
