import { describe, expect, it } from "vitest";
import { evaluateHowCookedAmI, matchHiddenCommand } from "./hidden-commands";

describe("Hidden Commands Matching (matchHiddenCommand)", () => {
  it("matches 'telemetry' and '44' exactly", () => {
    expect(matchHiddenCommand("telemetry")).toBe("telemetry");
    expect(matchHiddenCommand("TELEMETRY")).toBe("telemetry");
    expect(matchHiddenCommand("44")).toBe("telemetry");
  });

  it("matches 'how cooked am i' exactly", () => {
    expect(matchHiddenCommand("how cooked am i")).toBe("how_cooked_am_i");
    expect(matchHiddenCommand("  How Cooked Am I  ")).toBe("how_cooked_am_i");
  });

  it("matches 'los santos' exactly", () => {
    expect(matchHiddenCommand("los santos")).toBe("los_santos");
  });

  it("matches 'redline' exactly", () => {
    expect(matchHiddenCommand("redline")).toBe("about_redline");
  });

  it("returns null for partial or non-exact inputs", () => {
    expect(matchHiddenCommand("telem")).toBeNull();
    expect(matchHiddenCommand("cooked")).toBeNull();
    expect(matchHiddenCommand("santos")).toBeNull();
    expect(matchHiddenCommand("red")).toBeNull();
    expect(matchHiddenCommand("tasks")).toBeNull();
  });
});

describe("Deterministic Assessment (evaluateHowCookedAmI)", () => {
  it("evaluates light workload", () => {
    const res = evaluateHowCookedAmI({
      classesToday: 0,
      remainingTasks: 1,
      dueToday: 0,
      overdue: 0,
    });
    expect(res.level).toBe("light");
    expect(res.assessment).toContain("Suspiciously clear");
  });

  it("evaluates manageable workload", () => {
    const res = evaluateHowCookedAmI({
      classesToday: 1,
      remainingTasks: 3,
      dueToday: 1,
      overdue: 0,
    });
    expect(res.level).toBe("manageable");
    expect(res.assessment).toContain("don't start anything stupid");
  });

  it("evaluates busy workload with 1 overdue task", () => {
    const res = evaluateHowCookedAmI({
      classesToday: 2,
      remainingTasks: 4,
      dueToday: 2,
      overdue: 1,
    });
    expect(res.level).toBe("busy");
    expect(res.assessment).toContain("hard deadlines");
  });

  it("evaluates heavy workload with 2 overdue tasks", () => {
    const res = evaluateHowCookedAmI({
      classesToday: 2,
      remainingTasks: 6,
      dueToday: 3,
      overdue: 2,
    });
    expect(res.level).toBe("heavy");
    expect(res.assessment).toContain("High load");
  });

  it("evaluates absurd workload with 4+ overdue tasks or extreme volume", () => {
    const res = evaluateHowCookedAmI({
      classesToday: 3,
      remainingTasks: 12,
      dueToday: 4,
      overdue: 4,
    });
    expect(res.level).toBe("absurd");
    expect(res.assessment).toContain("Statistically concerning");
  });
});
