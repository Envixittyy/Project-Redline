/**
 * Calendar-day helpers for the dated task views.
 *
 * A due date is a calendar day with no time zone, so it is stored and compared
 * as a `YYYY-MM-DD` string. A scheduled start is a real instant, so narrowing it
 * to "today" means converting a calendar day into the pair of UTC instants that
 * bound that day in the user's zone.
 */

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const zonedInputPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const defaultTimeZone = "Asia/Manila";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone the dated views reason in. Life OS defaults to Asia/Manila rather
 * than the host runtime zone so server placement cannot move calendar days.
 */
export function resolveTimeZone(): string {
  const configured = process.env.APP_TIME_ZONE?.trim();
  if (configured && isValidTimeZone(configured)) return configured;

  return defaultTimeZone;
}

export function isIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isIsoInstant(value: string): boolean {
  if (value.trim() === "" || !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Today's calendar day in the given zone, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Shift a `YYYY-MM-DD` string by whole days. */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Invalid calendar date: ${isoDate}`);
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
  return new Date(fromZonedInputValue(`${isoDate}T00:00`, timeZone));
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
  if (!isIsoInstant(iso)) throw new RangeError(`Invalid instant: ${iso}`);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);

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
  const match = zonedInputPattern.exec(wallClock);
  if (!match) throw new RangeError(`Invalid wall clock: ${wallClock}`);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const [year, month, day, hour, minute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
  ].map(Number);
  const datePart = `${yearText}-${monthText}-${dayText}`;
  if (!isIsoDate(datePart) || hour > 23 || minute > 59) {
    throw new RangeError(`Invalid wall clock: ${wallClock}`);
  }

  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([
    zoneOffsetMs(wall - 86_400_000, timeZone),
    zoneOffsetMs(wall, timeZone),
    zoneOffsetMs(wall + 86_400_000, timeZone),
  ]);
  const candidates = [...offsets]
    .map((offset) => new Date(wall - offset).toISOString())
    .filter((candidate) => toZonedInputValue(candidate, timeZone) === wallClock)
    .sort();

  // On a fall-back transition the wall clock occurs twice. Choosing the first
  // occurrence is deterministic; callers can persist the resulting instant.
  if (candidates[0]) return candidates[0];

  // Spring-forward gaps are not silently shifted to a time the user did not
  // choose. Asia/Manila currently has no DST, but integrations may use zones
  // that do.
  throw new RangeError(`The wall clock ${wallClock} does not exist in ${timeZone}.`);
}
