export type HiddenCommandKind =
  | "telemetry"
  | "how_cooked_am_i"
  | "los_santos"
  | "about_redline";

export type CookedAssessmentLevel =
  | "light"
  | "manageable"
  | "busy"
  | "heavy"
  | "absurd";

export type CookedAssessment = {
  level: CookedAssessmentLevel;
  classesToday: number;
  remainingTasks: number;
  dueToday: number;
  overdue: number;
  breakdown: string;
  assessment: string;
};

/**
 * Matches an input query against the exact hidden command triggers.
 * Hidden commands never match partially or appear in autocomplete.
 */
export function matchHiddenCommand(query: string): HiddenCommandKind | null {
  const normalized = query.trim().toLowerCase();
  if (normalized === "telemetry" || normalized === "44") {
    return "telemetry";
  }
  if (normalized === "how cooked am i") {
    return "how_cooked_am_i";
  }
  if (normalized === "los santos") {
    return "los_santos";
  }
  if (normalized === "redline") {
    return "about_redline";
  }
  return null;
}

/**
 * Deterministically evaluates workload and returns a dry, self-aware assessment.
 * Strict rules:
 * - Uses real task & class numbers.
 * - Zero health/mental-health inference.
 * - No insulting or aggressive language.
 */
export function evaluateHowCookedAmI(input: {
  classesToday: number;
  remainingTasks: number;
  dueToday: number;
  overdue: number;
}): CookedAssessment {
  const { classesToday, remainingTasks, dueToday, overdue } = input;
  const score = remainingTasks + overdue * 3 + dueToday * 2 + classesToday;

  let level: CookedAssessmentLevel = "light";
  let assessment = "Completely fine. Suspiciously clear.";

  if (overdue >= 4 || score >= 24) {
    level = "absurd";
    assessment = "Statistically concerning. Triage immediately.";
  } else if (overdue >= 2 || score >= 16) {
    level = "heavy";
    assessment = "High load. Put the phone down and start clearing.";
  } else if (overdue >= 1 || score >= 8) {
    level = "busy";
    assessment =
      "Elevated. Focus on the hard deadlines before opening side quests.";
  } else if (score >= 3) {
    level = "manageable";
    assessment = "Manageable, but don't start anything stupid.";
  }

  const parts = [
    `${classesToday} ${classesToday === 1 ? "class" : "classes"}`,
    `${remainingTasks} remaining ${remainingTasks === 1 ? "task" : "tasks"}`,
    `${dueToday} due today`,
    `${overdue} overdue`,
  ];

  return {
    level,
    classesToday,
    remainingTasks,
    dueToday,
    overdue,
    breakdown: parts.join(" · "),
    assessment,
  };
}
