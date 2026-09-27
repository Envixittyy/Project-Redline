import { addDays, fromZonedInputValue, isIsoDate, isValidTimeZone, todayIn } from "@/lib/date/day";

export type EmailDeadline = { dueDate: string | null; dueAt: string | null; duePrecision: "none" | "date" | "instant" | "unresolved" };
const unresolved: EmailDeadline = { dueDate: null, dueAt: null, duePrecision: "unresolved" };
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Explicit calendar dates and unambiguous relative weekday times anchored to source time. */
export function parseEmailDeadline(
  input: string | null,
  timeZone: string,
  referenceDate?: string | Date | null,
): EmailDeadline {
  if (input === null) return { dueDate: null, dueAt: null, duePrecision: "none" };
  let value = input.trim();

  // Check if input is a relative weekday with time, e.g. "Friday 11:59 PM" or "Friday at 11:59 PM"
  const weekdayTimeMatch = value.match(/^(?:(mon|tues|wednes|thurs|fri|satur|sun)day)\s*,?\s*(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?.*)$/i);
  if (weekdayTimeMatch && referenceDate) {
    const ref = new Date(referenceDate);
    if (!Number.isNaN(ref.getTime())) {
      const todayStr = todayIn(timeZone, ref);
      const [year, month, day] = todayStr.split("-").map(Number);
      const currentDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const targetStr = weekdayTimeMatch[1].toLowerCase();
      const targetDay = targetStr.startsWith("sun") ? 0
        : targetStr.startsWith("mon") ? 1
        : targetStr.startsWith("tue") ? 2
        : targetStr.startsWith("wed") ? 3
        : targetStr.startsWith("thu") ? 4
        : targetStr.startsWith("fri") ? 5
        : 6;
      const diff = (targetDay - currentDay + 7) % 7;
      const daysToAdd = diff === 0 ? 0 : diff;
      const targetIsoDate = addDays(todayStr, daysToAdd);
      value = `${targetIsoDate} at ${weekdayTimeMatch[2]}`;
    }
  }

  // Strip leading weekday names before calendar dates, e.g. "Friday, September 15, 2026"
  value = value.replace(/^(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+/i, "");

  // Check day-first named month: e.g. "15 September 2026" or "15 September" or "15 Sep 2026"
  const dayFirst = value.match(/^(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{4}))?(.*)$/i);
  if (dayFirst) {
    const month = months.findIndex(m => m === dayFirst[2].toLowerCase() || m.slice(0, 3) === dayFirst[2].toLowerCase());
    if (month >= 0) {
      let year = dayFirst[3];
      if (!year && referenceDate) {
        const ref = new Date(referenceDate);
        if (!Number.isNaN(ref.getTime())) {
          const refYear = ref.getFullYear();
          const refMonth = ref.getMonth();
          year = String(month < refMonth && (refMonth - month) > 6 ? refYear + 1 : refYear);
        }
      }
      if (year) {
        value = `${year}-${String(month + 1).padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}${dayFirst[4]}`;
      }
    }
  }

  // Check month-first named month: e.g. "September 15, 2026" or "September 15"
  const named = value.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?(.*)$/i);
  if (named) {
    const month = months.findIndex(m => m === named[1].toLowerCase() || m.slice(0, 3) === named[1].toLowerCase());
    if (month >= 0) {
      let year = named[3];
      if (!year && referenceDate) {
        const ref = new Date(referenceDate);
        if (!Number.isNaN(ref.getTime())) {
          const refYear = ref.getFullYear();
          const refMonth = ref.getMonth();
          year = String(month < refMonth && (refMonth - month) > 6 ? refYear + 1 : refYear);
        }
      }
      if (year) {
        value = `${year}-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}${named[4]}`;
      }
    }
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
