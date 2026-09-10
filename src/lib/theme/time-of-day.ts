export type TimeOfDay = "morning" | "afternoon" | "evening" | "late-night";

export const timeOfDayVariants: readonly TimeOfDay[] = [
  "morning",
  "afternoon",
  "evening",
  "late-night",
] as const;

/**
 * Maps local hour to S7 Redline time-of-day visual variant:
 * - Morning: 05:00 – 11:59 (deep sky blue / restrained cyan / cool navy)
 * - Afternoon: 12:00 – 17:59 (cobalt / royal blue / darker sapphire)
 * - Evening: 18:00 – 21:59 (deep blue / indigo / very restrained violet)
 * - Late night: 22:00 – 04:59 (near-black navy / midnight blue / muted electric blue)
 */
export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) {
    return "morning";
  }
  if (hour >= 12 && hour < 18) {
    return "afternoon";
  }
  if (hour >= 18 && hour < 22) {
    return "evening";
  }
  return "late-night";
}
