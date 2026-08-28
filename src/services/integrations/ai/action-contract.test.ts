import { describe, expect, it } from "vitest";

import { parseAiActionProposal } from "./action-contract";
import { decideAiExecution } from "./permission-contract";

describe("AI action boundary", () => {
  it("parses a typed proposal without granting mutation authority", () => {
    const result = parseAiActionProposal({
      schema_version: 1,
      actions: [{ type: "create_task", title: "Read chapter 4", confidence: 0.95 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decideAiExecution(result.value.actions[0])).toBe("needs_confirmation");
    expect(decideAiExecution(result.value.actions[0], "suggest_only", true)).toBe("deny");
  });

  it("rejects unknown actions and invalid deterministic fields", () => {
    expect(parseAiActionProposal({
      schema_version: 1,
      actions: [{ type: "execute_sql", sql: "delete from tasks", confidence: 1 }],
    }).ok).toBe(false);

    expect(parseAiActionProposal({
      schema_version: 1,
      actions: [{
        type: "create_event",
        title: "Impossible",
        starts_at: "2026-08-29T10:00:00Z",
        ends_at: "2026-08-29T09:00:00Z",
        confidence: 1,
      }],
    }).ok).toBe(false);
  });
});
