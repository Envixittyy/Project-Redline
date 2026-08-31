import { describe, expect, it } from "vitest";
import {
  parseDailyPlanAdviceOutput,
  DAILY_PLAN_ADVICE_CAPABILITY,
} from "./daily-plan-contract";
import { AiTrustError } from "./trust-contract";

describe("Daily Plan Advice Contract", () => {
  const validHandle = "plan_handle_123";

  it("parses valid daily plan advice proposal", () => {
    const valid = JSON.stringify({
      schema_version: 1,
      type: "propose_daily_plan_advice",
      source_handle: validHandle,
      workloadExplanation: "Moderate workload with 2 morning classes and 1 heavy assignment.",
      prioritizationSuggestions: [
        "Tackle the Physics problem set before your afternoon lecture.",
        "Take a 20-minute break after CS lab.",
      ],
      scheduleRationale: "Deep work is scheduled during your 2-hour morning window.",
    });

    const parsed = parseDailyPlanAdviceOutput(valid, DAILY_PLAN_ADVICE_CAPABILITY.id, validHandle);
    expect(parsed.workloadExplanation).toContain("Moderate workload");
    expect(parsed.prioritizationSuggestions).toHaveLength(2);
    expect(parsed.scheduleRationale).toContain("Deep work");
  });

  it("rejects capability mismatch", () => {
    expect(() => parseDailyPlanAdviceOutput("{}", "other.cap", validHandle)).toThrow(AiTrustError);
  });
});
