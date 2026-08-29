import { createHash } from "node:crypto";
import { fromZonedInputValue, isIsoDate, isIsoInstant, isValidTimeZone } from "@/lib/date/day";

export type DuePrecision = "none" | "date" | "instant" | "unresolved";

export type BlackboardFeedItem = {
  uid: string;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  courseCode: string | null;
  startsAt: string | null;
  dueAt: string | null;
  dueDate: string | null;
  duePrecision: DuePrecision;
  contentHash: string;
  proposalRevision: string;
  sourceUpdatedAt: string | null;
  isFallbackUid: boolean;
};

type ParsedDateTime = {
  kind: "date" | "instant" | "unresolved";
  isoDate?: string;
  isoInstant?: string;
};

function unfold(source: string): string[] {
  return source.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function decodeIcalText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * Extracts date/time parameters and value from an iCal property line.
 */
function parseIcalDateTimeProperty(propLine: string): ParsedDateTime | null {
  const colonIndex = propLine.indexOf(":");
  if (colonIndex < 0) return null;

  const header = propLine.slice(0, colonIndex);
  const rawValue = propLine.slice(colonIndex + 1).trim();

  const params: Record<string, string> = {};
  const headerParts = header.split(";");
  for (let i = 1; i < headerParts.length; i++) {
    const [pKey, pVal] = headerParts[i].split("=");
    if (pKey && pVal) {
      params[pKey.toUpperCase()] = pVal.replace(/^"|"$/g, "");
    }
  }

  // 1. All-day date: YYYYMMDD (either VALUE=DATE or 8 digits)
  if (params.VALUE === "DATE" || /^\d{8}$/.test(rawValue)) {
    if (/^\d{8}$/.test(rawValue)) {
      const formatted = `${rawValue.slice(0, 4)}-${rawValue.slice(4, 6)}-${rawValue.slice(6, 8)}`;
      if (isIsoDate(formatted)) {
        return { kind: "date", isoDate: formatted };
      }
    }
    return null;
  }

  // 2. Timed instant with UTC (Z): YYYYMMDDTHHMMSSZ
  const utcMatch = rawValue.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i);
  if (utcMatch) {
    const [, y, m, d, h, min, s] = utcMatch;
    const isoString = `${y}-${m}-${d}T${h}:${min}:${s}Z`;
    if (isIsoInstant(isoString)) {
      return {
        kind: "instant",
        isoInstant: new Date(isoString).toISOString(),
        isoDate: `${y}-${m}-${d}`,
      };
    }
  }

  // 3. Timed instant with TZID: e.g. TZID=America/New_York:20260915T140000
  const localMatch = rawValue.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (localMatch) {
    const [, y, m, d, h, min] = localMatch;
    const datePart = `${y}-${m}-${d}`;
    const timePart = `${h}:${min}`;

    if (params.TZID && isValidTimeZone(params.TZID)) {
      try {
        const instantIso = fromZonedInputValue(`${datePart}T${timePart}`, params.TZID);
        return {
          kind: "instant",
          isoInstant: instantIso,
          isoDate: datePart,
        };
      } catch {
        return { kind: "unresolved" };
      }
    }

    // Floating local time without recognized time zone
    return { kind: "unresolved" };
  }

  return null;
}

function extractCourseCode(title: string, categories: string | null): string | null {
  const value = categories || title;
  const bracket = value.match(/\[([^\]]{2,30})\]/)?.[1];
  const code = bracket ?? value.match(/\b[A-Z]{2,8}[ -]?\d{2,5}[A-Z]?\b/i)?.[0];
  return code?.replace(/\s+/g, " ").trim().toUpperCase() ?? null;
}

/**
 * Computes canonical SHA-256 proposal revision hash from task-relevant semantic fields.
 * Excludes provider URL and sync timestamp churn.
 */
export function computeProposalRevision(input: {
  title: string;
  description: string | null;
  dueDate: string | null;
  dueAt: string | null;
  duePrecision: DuePrecision;
  courseCode: string | null;
}): string {
  const canonical = {
    schemaVersion: 1,
    courseCode: input.courseCode ? input.courseCode.trim() : null,
    description: input.description ? input.description.trim() : null,
    dueAt: input.dueAt ?? null,
    dueDate: input.dueDate ?? null,
    duePrecision: input.duePrecision,
    title: input.title.trim().replace(/\s+/g, " "),
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function parseBlackboardICalendar(source: string): BlackboardFeedItem[] {
  if (Buffer.byteLength(source, "utf8") > 2_000_000) {
    throw new Error("Calendar feed is too large.");
  }

  const rawEvents: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const line of unfold(source)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) rawEvents.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(":");
    if (separator < 1) continue;

    const propSignature = line.slice(0, separator);
    const key = propSignature.split(";")[0].toUpperCase();

    // Store raw property line for parameter preservation
    if (!current[key]) {
      current[key] = line;
    }
  }

  const seenUids = new Set<string>();
  const items: BlackboardFeedItem[] = [];

  for (const event of rawEvents) {
    const summaryLine = event.SUMMARY;
    const summaryVal = summaryLine ? decodeIcalText(summaryLine.slice(summaryLine.indexOf(":") + 1)) : "";
    const title = summaryVal.trim() || "Untitled Blackboard item";

    const descLine = event.DESCRIPTION;
    const description = descLine ? decodeIcalText(descLine.slice(descLine.indexOf(":") + 1)) : null;

    const urlLine = event.URL;
    const sourceUrl = urlLine ? decodeIcalText(urlLine.slice(urlLine.indexOf(":") + 1)) : null;

    const catLine = event.CATEGORIES;
    const categories = catLine ? decodeIcalText(catLine.slice(catLine.indexOf(":") + 1)) : null;
    const courseCode = extractCourseCode(title, categories);

    // Parse DTSTART and DTEND with parameter preservation
    const parsedStart = event.DTSTART ? parseIcalDateTimeProperty(event.DTSTART) : null;
    const parsedEnd = event.DTEND ? parseIcalDateTimeProperty(event.DTEND) : null;

    let startsAt: string | null = null;
    let dueAt: string | null = null;
    let dueDate: string | null = null;
    let duePrecision: DuePrecision = "none";

    if (parsedStart?.isoInstant) {
      startsAt = parsedStart.isoInstant;
    }

    if (parsedEnd) {
      if (parsedEnd.kind === "instant") {
        dueAt = parsedEnd.isoInstant ?? null;
        dueDate = parsedEnd.isoDate ?? null;
        duePrecision = "instant";
      } else if (parsedEnd.kind === "date") {
        dueDate = parsedEnd.isoDate ?? null;
        duePrecision = "date";
      } else if (parsedEnd.kind === "unresolved") {
        duePrecision = "unresolved";
      }
    } else if (parsedStart) {
      if (parsedStart.kind === "instant") {
        dueAt = parsedStart.isoInstant ?? null;
        dueDate = parsedStart.isoDate ?? null;
        duePrecision = "instant";
      } else if (parsedStart.kind === "date") {
        dueDate = parsedStart.isoDate ?? null;
        duePrecision = "date";
      } else if (parsedStart.kind === "unresolved") {
        duePrecision = "unresolved";
      }
    }

    const modifiedLine = event["LAST-MODIFIED"] || event.DTSTAMP;
    const parsedModified = modifiedLine ? parseIcalDateTimeProperty(modifiedLine) : null;
    const sourceUpdatedAt = parsedModified?.isoInstant ?? null;

    const uidLine = event.UID;
    const rawUid = uidLine ? decodeIcalText(uidLine.slice(uidLine.indexOf(":") + 1)).trim() : "";
    const isFallbackUid = !rawUid;

    const uid = rawUid || `fallback:${createHash("sha256").update([title, dueAt ?? dueDate ?? "", sourceUrl ?? ""].join("\0")).digest("hex")}`;

    if (seenUids.has(uid)) continue;
    seenUids.add(uid);

    const contentHash = createHash("sha256")
      .update(
        JSON.stringify({
          title,
          description,
          sourceUrl,
          dueAt,
          dueDate,
          duePrecision,
          sourceUpdatedAt,
        }),
      )
      .digest("hex");

    const proposalRevision = computeProposalRevision({
      title,
      description,
      dueDate,
      dueAt,
      duePrecision,
      courseCode,
    });

    items.push({
      uid,
      title,
      description,
      sourceUrl,
      courseCode,
      startsAt,
      dueAt,
      dueDate,
      duePrecision,
      contentHash,
      proposalRevision,
      sourceUpdatedAt,
      isFallbackUid,
    });
  }

  return items;
}
