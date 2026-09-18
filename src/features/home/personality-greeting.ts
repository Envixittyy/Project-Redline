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
 * Daytime (05:00–23:59): "So… ano na, Kyle?" / "Here’s what’s up."
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

  return {
    eyebrow: "SO, ANO NA?",
    greeting: `So… ano na, ${userName}?`,
    subtext: "Here’s what’s up.",
    isLateNight: false,
  };
}

/**
 * Formats a simple human workload line for the Home dashboard.
 * Open-task count determines primary tone, appended with due-soon/overdue details.
 */
export function formatWorkloadStatus(input: {
  openTaskCount: number;
  dueSoonCount?: number;
  overdueCount?: number;
}): string {
  const { openTaskCount, dueSoonCount = 0, overdueCount = 0 } = input;

  if (openTaskCount === 0 && overdueCount === 0 && dueSoonCount === 0) {
    return "Nothing urgent. Suspiciously peaceful.";
  }

  let descriptor: string;
  if (overdueCount >= 3) {
    descriptor = "triage immediately";
  } else if (overdueCount >= 1) {
    descriptor = "handle overdue items first";
  } else if (openTaskCount === 0) {
    descriptor = "suspiciously peaceful";
  } else if (openTaskCount <= 3) {
    descriptor = "pretty chill";
  } else if (openTaskCount <= 6) {
    descriptor = "manageable naman";
  } else if (openTaskCount <= 10) {
    descriptor = "medyo marami na ’to";
  } else {
    descriptor = "okay, shit’s piling up";
  }

  const parts: string[] = [];

  if (openTaskCount > 0) {
    parts.push(
      `${openTaskCount} ${openTaskCount === 1 ? "thing" : "things"} open`,
    );
  }

  if (overdueCount > 0) {
    parts.push(`${overdueCount} overdue`);
  }

  if (dueSoonCount > 0) {
    parts.push(`${dueSoonCount} due soon`);
  }

  parts.push(descriptor);

  return parts.join(" · ");
}

/**
 * Computes a deterministic workload assessment for the Home status line.
 * Strict rule: Workload only. Never infer or mention health or mental state.
 */
export function getSystemLoadTelemetry(input: {
  openTaskCount: number;
  dueSoonCount: number;
  overdueCount: number;
  todayClassCount: number;
}): SystemTelemetry {
  const { openTaskCount, dueSoonCount, overdueCount } = input;

  let loadLevel: SystemLoadLevel = "nominal";
  if (overdueCount >= 3 || openTaskCount >= 11) {
    loadLevel = "absurd";
  } else if (overdueCount >= 1 || openTaskCount >= 7) {
    loadLevel = "heavy";
  } else if (dueSoonCount > 0 || openTaskCount >= 4) {
    loadLevel = "elevated";
  } else if (openTaskCount >= 1) {
    loadLevel = "moderate";
  }

  const telemetryText = formatWorkloadStatus({
    openTaskCount,
    dueSoonCount,
    overdueCount,
  });

  let shortAssessment: string;
  if (overdueCount >= 3) {
    shortAssessment = "Triage overdue items immediately.";
  } else if (overdueCount >= 1) {
    shortAssessment = "Handle overdue items first.";
  } else if (openTaskCount === 0) {
    shortAssessment = "Nothing urgent. Suspiciously peaceful.";
  } else if (openTaskCount <= 3) {
    shortAssessment = "Pretty chill";
  } else if (openTaskCount <= 6) {
    shortAssessment = "Manageable naman";
  } else if (openTaskCount <= 10) {
    shortAssessment = "Medyo marami na ’to";
  } else {
    shortAssessment = "Okay, shit’s piling up";
  }

  return {
    loadLevel,
    telemetryText,
    shortAssessment,
  };
}
