import { describe, expect, it } from "vitest";
import {
  parseDailyPlanAdviceOutput,
  DAILY_PLAN_ADVICE_CAPABILITY,
  dailyPlanAdvicePrompt,
} from "./daily-plan-contract";
import { AiTrustError } from "./trust-contract";
import { cloudAllowed, routingChain, type RoutingPreferences } from "./routing-contract";

describe("Daily Plan Advice Contract & Boundaries", () => {
  const validHandle = "plan_handle_123";

  const validPayload = {
    schema_version: 1,
    type: "propose_daily_plan_advice",
    source_handle: validHandle,
    workloadExplanation: "Moderate workload with 2 morning classes and 1 heavy assignment.",
    prioritizationSuggestions: [
      "Tackle the Physics problem set before your afternoon lecture.",
      "Take a 20-minute break after CS lab.",
    ],
    scheduleRationale: "Deep work is scheduled during your 2-hour morning window.",
  };

  it("parses valid daily plan advice proposal within limits", () => {
    const validJson = JSON.stringify(validPayload);
    const parsed = parseDailyPlanAdviceOutput(validJson, DAILY_PLAN_ADVICE_CAPABILITY.id, validHandle);
    expect(parsed.workloadExplanation).toContain("Moderate workload");
    expect(parsed.prioritizationSuggestions).toHaveLength(2);
    expect(parsed.scheduleRationale).toContain("Deep work");
    expect(parsed.source_handle).toBe(validHandle);
  });

  it("rejects capability mismatch", () => {
    expect(() => parseDailyPlanAdviceOutput(JSON.stringify(validPayload), "other.cap", validHandle)).toThrow(
      AiTrustError,
    );
  });

  it("rejects source handle mismatch", () => {
    expect(() =>
      parseDailyPlanAdviceOutput(JSON.stringify(validPayload), DAILY_PLAN_ADVICE_CAPABILITY.id, "wrong_handle"),
    ).toThrow(AiTrustError);
  });

  it("rejects malformed output, wrong schema_version, or wrong type", () => {
    expect(() =>
      parseDailyPlanAdviceOutput(
        JSON.stringify({ ...validPayload, schema_version: 2 }),
        DAILY_PLAN_ADVICE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);

    expect(() =>
      parseDailyPlanAdviceOutput(
        JSON.stringify({ ...validPayload, type: "wrong_type" }),
        DAILY_PLAN_ADVICE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);

    expect(() =>
      parseDailyPlanAdviceOutput("not json", DAILY_PLAN_ADVICE_CAPABILITY.id, validHandle),
    ).toThrow(AiTrustError);
  });

  it("rejects missing required narrative fields", () => {
    expect(() =>
      parseDailyPlanAdviceOutput(
        JSON.stringify({ ...validPayload, workloadExplanation: "" }),
        DAILY_PLAN_ADVICE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);

    expect(() =>
      parseDailyPlanAdviceOutput(
        JSON.stringify({ ...validPayload, scheduleRationale: "" }),
        DAILY_PLAN_ADVICE_CAPABILITY.id,
        validHandle,
      ),
    ).toThrow(AiTrustError);
  });

  it("rejects oversized output exceeding byte budget", () => {
    const huge = JSON.stringify({
      ...validPayload,
      workloadExplanation: "a".repeat(20000),
    });
    expect(() =>
      parseDailyPlanAdviceOutput(huge, DAILY_PLAN_ADVICE_CAPABILITY.id, validHandle),
    ).toThrow(AiTrustError);
  });

  it("rejects excessive output without truncation", () => {
    const manySuggestions = JSON.stringify({
      ...validPayload,
      prioritizationSuggestions: [
        "Tip 1",
        "Tip 2",
        "Tip 3",
        "Tip 4",
        "Tip 5",
        "Tip 6",
        "Tip 7 (excess)",
        "Tip 8 (excess)",
      ],
    });
    expect(() => parseDailyPlanAdviceOutput(manySuggestions, DAILY_PLAN_ADVICE_CAPABILITY.id, validHandle)).toThrow(AiTrustError);
  });

  it("constructs canonical prompt marking context untrusted_data without instructions", () => {
    const prompt = dailyPlanAdvicePrompt(validHandle, {
      today: "2026-09-02",
      timeZone: "America/New_York",
      tasks: [{ title: "Math Homework", priority: "high" }],
      events: [{ title: "Physics Lecture", start: "10:00", end: "11:00", allDay: false }],
      workloadScore: 55,
      workloadCategory: "moderate",
    });

    expect(prompt.prompt).toContain("untrusted_data");
    expect(prompt.prompt).toContain(validHandle);
    expect(prompt.prompt).toContain("Math Homework");
    expect(prompt.prompt).toContain("Physics Lecture");
    expect(prompt.systemPrompt).toContain("propose_daily_plan_advice");
    expect(prompt.formatJson).toBe(true);
  });

  describe("Cloud Privacy Isolation", () => {
    const basePrefs: RoutingPreferences = {
      aiMode: "auto",
      cloudEnabled: true,
      cloudFallbackMode: "always",
      preferredCloud: "gemini",
      secondaryCloud: false,
      checklistCloud: false,
      courseImportCloud: false,
      dailyPlanCloud: false,
      courseMaterialCloud: false,
      contextualAssistantCloud: false,
    };

    it("denies cloud egress when dailyPlanCloud is false, even if other capabilities are enabled", () => {
      const prefsWithOthersEnabled: RoutingPreferences = {
        ...basePrefs,
        checklistCloud: true,
        courseImportCloud: true,
        schoolScheduleCloud: true,
        dailyPlanCloud: false,
      };

      expect(cloudAllowed(DAILY_PLAN_ADVICE_CAPABILITY.id, prefsWithOthersEnabled)).toBe(false);
      const chain = routingChain(prefsWithOthersEnabled, DAILY_PLAN_ADVICE_CAPABILITY.id);
      expect(chain).toEqual(["local"]);
    });

    it("allows cloud egress only when dailyPlanCloud is explicitly true and cloudEnabled", () => {
      const prefsDailyEnabled: RoutingPreferences = {
        ...basePrefs,
        dailyPlanCloud: true,
      };

      expect(cloudAllowed(DAILY_PLAN_ADVICE_CAPABILITY.id, prefsDailyEnabled)).toBe(true);
      const chain = routingChain(prefsDailyEnabled, DAILY_PLAN_ADVICE_CAPABILITY.id);
      expect(chain).toContain("gemini");
    });

    it("fails closed when cloud is globally disabled regardless of dailyPlanCloud", () => {
      const prefsCloudOff: RoutingPreferences = {
        ...basePrefs,
        cloudEnabled: false,
        dailyPlanCloud: true,
      };

      expect(cloudAllowed(DAILY_PLAN_ADVICE_CAPABILITY.id, prefsCloudOff)).toBe(false);
      const chain = routingChain(prefsCloudOff, DAILY_PLAN_ADVICE_CAPABILITY.id);
      expect(chain).toEqual(["local"]);
    });
  });
});
