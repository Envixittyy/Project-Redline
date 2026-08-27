/**
 * Calendar-day helpers for the dated task views.
 *
 * A due date is a calendar day with no time zone, so it is stored and compared
 * as a `YYYY-MM-DD` string. A scheduled start is a real instant, so narrowing it
 * to "today" means converting a calendar day into the pair of UTC instants that
 * bound that day in the user's zone.
 */

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The zone the dated views reason in. Defaults to the runtime's own zone, which
 * is correct in local development and usually UTC on a host, so deployments
 * should set APP_TIME_ZONE.
 */
export function resolveTimeZone(): string {
  const configured = process.env.APP_TIME_ZONE?.trim();
  if (configured) return configured;

  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isIsoDate(value: string): boolean {
  return isoDatePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Today's calendar day in the given zone, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift a `YYYY-MM-DD` string by whole days. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** How far the zone is ahead of UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const wallClock = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // Some runtimes render midnight as hour 24.
    read("hour") % 24,
    read("minute"),
    read("second"),
  );

  return wallClock - instant;
}

/** The instant at which a calendar day begins in the given zone. */
export function startOfDayIn(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const wallClock = Date.UTC(year, month - 1, day);

  // Two passes so a day that begins on a DST boundary still resolves.
  const firstPass = wallClock - zoneOffsetMs(wallClock, timeZone);
  return new Date(wallClock - zoneOffsetMs(firstPass, timeZone));
}

/** Half-open instant range `[start, end)` covering whole calendar days. */
export function dayRangeIn(
  fromIsoDate: string,
  toIsoDateExclusive: string,
  timeZone: string,
): { start: string; end: string } {
  return {
    start: startOfDayIn(fromIsoDate, timeZone).toISOString(),
    end: startOfDayIn(toIsoDateExclusive, timeZone).toISOString(),
  };
}

/** Wall-clock text for an `<input type="datetime-local">`, rendered in the zone. */
export function toZonedInputValue(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const hour = read("hour") === "24" ? "00" : read("hour");

  return `${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}`;
}

/** Inverse of {@link toZonedInputValue}: a wall clock in the zone becomes an instant. */
export function fromZonedInputValue(wallClock: string, timeZone: string): string {
  const [datePart, timePart = "00:00"] = wallClock.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = wall - zoneOffsetMs(wall, timeZone);

  return new Date(wall - zoneOffsetMs(firstPass, timeZone)).toISOString();
}
