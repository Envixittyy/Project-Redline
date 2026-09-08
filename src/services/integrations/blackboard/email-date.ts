import { fromZonedInputValue, isIsoDate, isValidTimeZone, todayIn } from "@/lib/date/day";

export type EmailDeadline = { dueDate: string | null; dueAt: string | null; duePrecision: "none" | "date" | "instant" | "unresolved" };
const unresolved: EmailDeadline = { dueDate: null, dueAt: null, duePrecision: "unresolved" };
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Explicit calendar dates only: no relative-date guesses or runtime-zone parsing. */
export function parseEmailDeadline(input: string | null, timeZone: string): EmailDeadline {
  if (input === null) return { dueDate: null, dueAt: null, duePrecision: "none" };
  let value = input.trim().replace(/^(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+/i, "");
  const named = value.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})(.*)$/i);
  if (named) {
    const month = months.findIndex(m => m === named[1].toLowerCase() || m.slice(0, 3) === named[1].toLowerCase());
    if (month < 0) return unresolved;
    value = `${named[3]}-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}${named[4]}`;
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:(?:T|\s+(?:at\s+)?)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}|[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)?)?$/i);
  if (!match || !isIsoDate(match[1])) return unresolved;
  if (!match[2]) return { dueDate: match[1], dueAt: null, duePrecision: "date" };
  let hour = Number(match[2]);
  if (match[5]) {
    if (hour < 1 || hour > 12) return unresolved;
    hour = hour % 12 + (match[5].toUpperCase() === "PM" ? 12 : 0);
  }
  if (hour > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return unresolved;
  const wall = `${match[1]}T${String(hour).padStart(2, "0")}:${match[3]}`;
  const zone = match[6] ?? timeZone;
  try {
    let dueAt: string;
    if (/^(Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i.test(zone)) {
      const offset = /^[+-]/.test(zone) ? zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") : "Z";
      if (offset !== "Z" && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59 || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0))) return unresolved;
      dueAt = new Date(`${wall}:${match[4] ?? "00"}${offset}`).toISOString();
    } else {
      if (!isValidTimeZone(zone)) return unresolved;
      dueAt = new Date(Date.parse(fromZonedInputValue(wall, zone)) + Number(match[4] ?? 0) * 1000).toISOString();
    }
    return { dueDate: todayIn(timeZone, new Date(dueAt)), dueAt, duePrecision: "instant" };
  } catch { return unresolved; }
}
