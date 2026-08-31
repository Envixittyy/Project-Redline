import { describe, expect, it } from "vitest";
import {
  parseNoteSummaryOutput,
  parseNoteRewriteOutput,
  parseNoteActionItemsOutput,
  NOTE_SUMMARY_CAPABILITY,
  NOTE_REWRITE_CAPABILITY,
  NOTE_ACTION_ITEMS_CAPABILITY,
} from "./note-intelligence-contract";
import { AiTrustError } from "./trust-contract";

describe("Note Intelligence Contracts", () => {
  const validHandle = "note_handle_123";

  describe("Note Summary", () => {
    it("parses valid note summary proposal", () => {
      const valid = JSON.stringify({
        schema_version: 1,
        type: "propose_note_summary",
        source_handle: validHandle,
        summary: "This note covers calculus fundamentals including limits and derivatives.",
        keyPoints: ["Limit definition", "Power rule", "Chain rule"],
      });

      const parsed = parseNoteSummaryOutput(valid, NOTE_SUMMARY_CAPABILITY.id, validHandle);
      expect(parsed.summary).toContain("calculus fundamentals");
      expect(parsed.keyPoints).toHaveLength(3);
    });

    it("rejects capability mismatch", () => {
      expect(() => parseNoteSummaryOutput("{}", "other.cap", validHandle)).toThrow(AiTrustError);
    });
  });

  describe("Note Rewrite", () => {
    it("parses valid note rewrite proposal", () => {
      const valid = JSON.stringify({
        schema_version: 1,
        type: "propose_note_rewrite",
        source_handle: validHandle,
        rewrittenTitle: "Clean Title",
        rewrittenBody: "# Clean Title\n\nOrganized markdown text.",
        changesExplanation: "Added headings and fixed spelling.",
      });

      const parsed = parseNoteRewriteOutput(valid, NOTE_REWRITE_CAPABILITY.id, validHandle);
      expect(parsed.rewrittenBody).toContain("Organized markdown");
      expect(parsed.changesExplanation).toBe("Added headings and fixed spelling.");
    });
  });

  describe("Note Action Items", () => {
    it("parses valid note action items proposal", () => {
      const valid = JSON.stringify({
        schema_version: 1,
        type: "propose_note_action_items",
        source_handle: validHandle,
        actionItems: [
          {
            title: "Submit Lab Report",
            dueDate: "2026-03-05",
            priority: "high",
          },
        ],
      });

      const parsed = parseNoteActionItemsOutput(valid, NOTE_ACTION_ITEMS_CAPABILITY.id, validHandle);
      expect(parsed.actionItems).toHaveLength(1);
      expect(parsed.actionItems[0].title).toBe("Submit Lab Report");
      expect(parsed.actionItems[0].priority).toBe("high");
    });
  });
});
