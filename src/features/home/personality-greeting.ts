import { resolveTimeZone } from "@/lib/date/day";

export type SystemLoadLevel =
  | "nominal"
  | "moderate"
  | "elevated"
  | "heavy"
  | "absurd";

export type HomeGreeting = {
  eyebrow: string;
  greeting: string;
  subtext: string;
  isLateNight: boolean;
};

export type SystemTelemetry = {
  loadLevel: SystemLoadLevel;
  telemetryText: string;
  shortAssessment: string;
};

/**
 * Returns a time-aware personal greeting for the Home dashboard.
 * Morning (05:00–11:59): "Good morning, Kyle."
 * Afternoon (12:00–16:59): "Good afternoon, Kyle."
 * Evening (17:00–23:59): "Good evening, Kyle."
 * Late night (00:00–04:59): "You're still here, Kyle. Let's at least make this useful."
 */
export function getTimeAwareGreeting(
  userName = "Kyle",
  currentInstant?: Date,
  timeZone?: string,
): HomeGreeting {
  const tz = timeZone || resolveTimeZone();
  const now = currentInstant ?? new Date();

  const hourString = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);

  const hour = parseInt(hourString, 10);

  if (hour >= 0 && hour < 5) {
    return {
      eyebrow: "SO, ANO NA?",
      greeting: `You're still here, ${userName}.`,
      subtext: "Let's at least make this useful.",
      isLateNight: true,
    };
  }

  if (hour >= 5 && hour < 12) {
    return {
      eyebrow: "SO, ANO NA?",
      greeting: `Good morning, ${userName}.`,
      subtext: "Okay, what the fuck is happening today?",
      isLateNight: false,
    };
  }

  if (hour >= 12 && hour < 17) {
    return {
      eyebrow: "SO, ANO NA?",
      greeting: `Good afternoon, ${userName}.`,
      subtext: "Here's where things stand.",
      isLateNight: false,
    };
  }

  return {
    eyebrow: "SO, ANO NA?",
    greeting: `Good evening, ${userName}.`,
    subtext: "Here's where things stand.",
    isLateNight: false,
  };
}

/**
 * Computes a deterministic workload assessment string for status/telemetry.
 * Strict rule: Workload only. Never infer or mention health or mental state.
 */
export function getSystemLoadTelemetry(input: {
  openTaskCount: number;
  dueSoonCount: number;
  overdueCount: number;
  todayClassCount: number;
}): SystemTelemetry {
  const { openTaskCount, dueSoonCount, overdueCount, todayClassCount } = input;
  const weightedScore =
    openTaskCount + overdueCount * 2 + dueSoonCount + todayClassCount;

  let loadLevel: SystemLoadLevel = "nominal";
  let shortAssessment = "System load nominal. Suspiciously peaceful.";

  if (overdueCount >= 3 || weightedScore >= 14) {
    loadLevel = "absurd";
    shortAssessment = "Statistically concerning. Triage immediately.";
  } else if (overdueCount >= 2 || weightedScore >= 9) {
    loadLevel = "heavy";
    shortAssessment =
      "High load. Clear hard deadlines before opening side quests.";
  } else if (overdueCount >= 1 || weightedScore >= 5) {
    loadLevel = "elevated";
    shortAssessment = "Elevated workload. Focus on priority commitments.";
  } else if (weightedScore >= 2) {
    loadLevel = "moderate";
    shortAssessment = "Manageable, but don't start anything stupid.";
  }

  const parts: string[] = [];
  if (todayClassCount > 0) {
    parts.push(
      `${todayClassCount} ${todayClassCount === 1 ? "CLASS" : "CLASSES"}`,
    );
  }
  parts.push(`${openTaskCount} OPEN`);
  if (dueSoonCount > 0) {
    parts.push(`${dueSoonCount} DUE SOON`);
  }
  if (overdueCount > 0) {
    parts.push(`${overdueCount} OVERDUE`);
  }
  parts.push(`SYSTEM LOAD: ${loadLevel.toUpperCase()}`);

  return {
    loadLevel,
    telemetryText: parts.join(" · "),
    shortAssessment,
  };
}
