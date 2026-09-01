import { createHash } from "node:crypto";

import {
  addDays,
  fromZonedInputValue,
  isIsoDate,
  isIsoInstant,
  isValidTimeZone,
  startOfDayIn,
} from "@/lib/date/day";
import { AiTrustError } from "./trust-contract";

export const ACADEMIC_CALENDAR_FORMATS = [
  "ics",
  "csv",
  "txt",
  "md",
  "png",
  "jpeg",
  "webp",
] as const;

export type AcademicCalendarFormat = (typeof ACADEMIC_CALENDAR_FORMATS)[number];
export type AcademicCalendarEventType =
  | "holiday"
  | "term_start"
  | "term_end"
  | "exam_period"
  | "break"
  | "deadline"
  | "event";

export type CanonicalAcademicEvent = {
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  eventType: AcademicCalendarEventType;
};

export type ResolvedAcademicEntry = {
  identityKind: "ics_uid" | "csv_id" | "structure_semantic" | "resolved_semantic";
  identityKey: string;
  structureKey: string | null;
  identityEvidence: string;
  event: CanonicalAcademicEvent;
};

const EVENT_TYPES = new Set<AcademicCalendarEventType>([
  "holiday",
  "term_start",
  "term_end",
  "exam_period",
  "break",
  "deadline",
  "event",
]);
const MAX_EVENTS = 60;
const MAX_TITLE = 150;
const MAX_DESCRIPTION = 500;
const MAX_EVIDENCE = 500;
const UID = /^[^\u0000-\u0020\u007f]{1,255}$/u;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function strictText(value: unknown, max: number, optional = false): string | null {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new AiTrustError("invalid_output");
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value !== value.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new AiTrustError("invalid_output");
  }
  return value;
}

function normalizeType(value: unknown): AcademicCalendarEventType {
  if (typeof value !== "string" || !EVENT_TYPES.has(value as AcademicCalendarEventType)) {
    throw new AiTrustError("invalid_output");
  }
  return value as AcademicCalendarEventType;
}

export function canonicalizeAcademicEvent(
  input: {
    title: unknown;
    description?: unknown;
    start: unknown;
    end?: unknown;
    allDay: unknown;
    eventType: unknown;
  },
  timeZone: string,
): CanonicalAcademicEvent {
  if (!isValidTimeZone(timeZone)) throw new AiTrustError("invalid_output");
  const title = strictText(input.title, MAX_TITLE)!;
  const description = strictText(input.description, MAX_DESCRIPTION, true);
  if (typeof input.allDay !== "boolean") throw new AiTrustError("invalid_output");
  const eventType = normalizeType(input.eventType);

  if (input.allDay) {
    if (typeof input.start !== "string" || !isIsoDate(input.start)) {
      throw new AiTrustError("invalid_output");
    }
    const endDate = input.end === undefined ? addDays(input.start, 1) : input.end;
    if (typeof endDate !== "string" || !isIsoDate(endDate) || endDate <= input.start) {
      throw new AiTrustError("invalid_output");
    }
    return {
      title,
      description,
      start: startOfDayIn(input.start, timeZone).toISOString(),
      end: startOfDayIn(endDate, timeZone).toISOString(),
      allDay: true,
      eventType,
    };
  }

  if (
    typeof input.start !== "string" ||
    typeof input.end !== "string" ||
    !isIsoInstant(input.start) ||
    !isIsoInstant(input.end)
  ) {
    throw new AiTrustError("invalid_output");
  }
  const start = new Date(input.start).toISOString();
  const end = new Date(input.end).toISOString();
  if (end <= start) throw new AiTrustError("invalid_output");
  return { title, description, start, end, allDay: false, eventType };
}

function unfoldIcs(source: string): Array<{ line: string; number: number }> {
  const physical = source.replace(/\r\n?/g, "\n").split("\n");
  const result: Array<{ line: string; number: number }> = [];
  for (let index = 0; index < physical.length; index += 1) {
    const line = physical[index];
    if (/^[ \t]/.test(line) && result.length > 0) result[result.length - 1].line += line.slice(1);
    else result.push({ line, number: index + 1 });
  }
  return result;
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

type IcsValue = { name: string; params: Record<string, string>; value: string; line: number };

function parseIcsProperty(line: string, number: number): IcsValue | null {
  const separator = line.indexOf(":");
  if (separator < 1) return null;
  const parts = line.slice(0, separator).split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    if (equals < 1) throw new AiTrustError("invalid_output");
    params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value: line.slice(separator + 1), line: number };
}

function parseIcsTemporal(prop: IcsValue): { value: string; allDay: boolean } {
  const raw = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(raw)) {
    if (!/^\d{8}$/.test(raw)) throw new AiTrustError("invalid_output");
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (!isIsoDate(date)) throw new AiTrustError("invalid_output");
    return { value: date, allDay: true };
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) throw new AiTrustError("invalid_output");
  const [, year, month, day, hour, minute, second, zulu] = match;
  const date = `${year}-${month}-${day}`;
  if (!isIsoDate(date)) throw new AiTrustError("invalid_output");
  if (zulu) {
    const instant = `${date}T${hour}:${minute}:${second}Z`;
    if (!isIsoInstant(instant)) throw new AiTrustError("invalid_output");
    return { value: new Date(instant).toISOString(), allDay: false };
  }
  const zone = prop.params.TZID;
  if (!zone || !isValidTimeZone(zone)) throw new AiTrustError("invalid_output");
  try {
    return { value: fromZonedInputValue(`${date}T${hour}:${minute}`, zone), allDay: false };
  } catch {
    throw new AiTrustError("invalid_output");
  }
}

function eventTypeFromText(value: string): AcademicCalendarEventType {
  const normalized = value.toLowerCase();
  if (/holiday|campus closed/.test(normalized)) return "holiday";
  if (/term|semester/.test(normalized) && /start|begin/.test(normalized)) return "term_start";
  if (/term|semester/.test(normalized) && /end|finish/.test(normalized)) return "term_end";
  if (/exam/.test(normalized) && /period|week/.test(normalized)) return "exam_period";
  if (/break|reading period/.test(normalized)) return "break";
  if (/deadline|last day|due/.test(normalized)) return "deadline";
  return "event";
}

export function parseAcademicIcs(source: string, timeZone: string): ResolvedAcademicEntry[] {
  if (!source || Buffer.byteLength(source, "utf8") > 256 * 1024) throw new AiTrustError("invalid_output");
  const events: Array<{ startLine: number; properties: Map<string, IcsValue> }> = [];
  let current: { startLine: number; properties: Map<string, IcsValue> } | null = null;
  for (const row of unfoldIcs(source)) {
    if (row.line.toUpperCase() === "BEGIN:VEVENT") {
      if (current) throw new AiTrustError("invalid_output");
      current = { startLine: row.number, properties: new Map() };
      continue;
    }
    if (row.line.toUpperCase() === "END:VEVENT") {
      if (!current) throw new AiTrustError("invalid_output");
      events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const property = parseIcsProperty(row.line, row.number);
    if (!property) continue;
    if (["UID", "RECURRENCE-ID", "SUMMARY", "DESCRIPTION", "DTSTART", "DTEND", "CATEGORIES"].includes(property.name)) {
      if (current.properties.has(property.name)) throw new AiTrustError("invalid_output");
      current.properties.set(property.name, property);
    }
  }
  if (current || events.length < 1 || events.length > MAX_EVENTS) throw new AiTrustError("invalid_output");

  const seen = new Set<string>();
  return events.map(({ startLine, properties }) => {
    const summary = strictText(decodeIcsText(properties.get("SUMMARY")?.value ?? ""), MAX_TITLE)!;
    const description = properties.has("DESCRIPTION")
      ? strictText(decodeIcsText(properties.get("DESCRIPTION")!.value), MAX_DESCRIPTION, true)
      : null;
    const startProp = properties.get("DTSTART");
    if (!startProp) throw new AiTrustError("invalid_output");
    const start = parseIcsTemporal(startProp);
    const endProp = properties.get("DTEND");
    const parsedEnd = endProp ? parseIcsTemporal(endProp) : undefined;
    if (parsedEnd && parsedEnd.allDay !== start.allDay) throw new AiTrustError("invalid_output");
    const event = canonicalizeAcademicEvent(
      {
        title: summary,
        description,
        start: start.value,
        end: parsedEnd?.value,
        allDay: start.allDay,
        eventType: eventTypeFromText(`${summary} ${properties.get("CATEGORIES")?.value ?? ""}`),
      },
      timeZone,
    );

    const rawUid = decodeIcsText(properties.get("UID")?.value ?? "").trim();
    const recurrence = properties.get("RECURRENCE-ID");
    const recurrenceValue = recurrence ? parseIcsTemporal(recurrence).value : null;
    let identityKind: ResolvedAcademicEntry["identityKind"];
    let identityKey: string;
    let identityEvidence: string;
    if (rawUid) {
      if (!UID.test(rawUid)) throw new AiTrustError("invalid_output");
      identityKind = "ics_uid";
      identityEvidence = recurrenceValue ? `${rawUid}\u0000${recurrenceValue}` : rawUid;
      identityKey = `ics:${hash([rawUid, recurrenceValue])}`;
      if (seen.has(identityKey)) throw new AiTrustError("invalid_output");
      seen.add(identityKey);
    } else {
      identityKind = "structure_semantic";
      identityEvidence = `VEVENT line ${startLine}`;
      identityKey = `ics-fallback:${hash([startLine, event.title, event.start, event.eventType])}`;
    }
    return {
      identityKind,
      identityKey,
      structureKey: `ics-line:${startLine}`,
      identityEvidence,
      event,
    };
  });
}

type CsvCell = { value: string; line: number };

function parseCsvRows(source: string): CsvCell[][] {
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let cellLine = 1;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? "\n";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else {
        value += char;
        if (char === "\n") line += 1;
      }
      continue;
    }
    if (char === '"' && value === "") quoted = true;
    else if (char === ",") {
      row.push({ value, line: cellLine });
      value = "";
      cellLine = line;
    } else if (char === "\r") continue;
    else if (char === "\n") {
      row.push({ value, line: cellLine });
      if (row.some((cell) => cell.value !== "")) rows.push(row);
      row = [];
      value = "";
      line += 1;
      cellLine = line;
    } else value += char;
  }
  if (quoted) throw new AiTrustError("invalid_output");
  return rows;
}

export function parseAcademicCsv(source: string, timeZone: string): ResolvedAcademicEntry[] {
  if (!source || Buffer.byteLength(source, "utf8") > 256 * 1024) throw new AiTrustError("invalid_output");
  const rows = parseCsvRows(source);
  if (rows.length < 2 || rows.length > MAX_EVENTS + 1) throw new AiTrustError("invalid_output");
  const headers = rows[0].map((cell) => cell.value.trim().toLowerCase());
  const allowed = new Set(["id", "title", "start", "end", "all_day", "event_type", "description"]);
  if (new Set(headers).size !== headers.length || headers.some((header) => !allowed.has(header)) || !headers.includes("title") || !headers.includes("start")) {
    throw new AiTrustError("invalid_output");
  }
  const at = (row: CsvCell[], name: string) => row[headers.indexOf(name)]?.value.trim();
  const idsPresent = headers.includes("id");
  const seen = new Set<string>();
  return rows.slice(1).map((row) => {
    if (row.length !== headers.length) throw new AiTrustError("invalid_output");
    const allDayText = at(row, "all_day") || "true";
    if (!/^(true|false)$/i.test(allDayText)) throw new AiTrustError("invalid_output");
    const event = canonicalizeAcademicEvent(
      {
        title: at(row, "title"),
        description: at(row, "description") || undefined,
        start: at(row, "start"),
        end: at(row, "end") || undefined,
        allDay: allDayText.toLowerCase() === "true",
        eventType: at(row, "event_type") || "event",
      },
      timeZone,
    );
    const explicitId = at(row, "id");
    if (idsPresent && (!explicitId || !UID.test(explicitId))) throw new AiTrustError("invalid_output");
    const identityKind: ResolvedAcademicEntry["identityKind"] = explicitId ? "csv_id" : "structure_semantic";
    const identityKey = explicitId
      ? `csv:${hash(explicitId)}`
      : `csv-fallback:${hash([row[0].line, event.title, event.start, event.eventType])}`;
    if (seen.has(identityKey)) throw new AiTrustError("invalid_output");
    seen.add(identityKey);
    return {
      identityKind,
      identityKey,
      structureKey: `csv-line:${row[0].line}`,
      identityEvidence: explicitId ?? `CSV record line ${row[0].line}`,
      event,
    };
  });
}

export function resolveExtractedAcademicEntries(
  format: "txt" | "md" | "png" | "jpeg" | "webp",
  normalizedSource: string | null,
  events: Array<CanonicalAcademicEvent & { evidence?: string | null }>,
): ResolvedAcademicEntry[] {
  if (events.length < 1 || events.length > MAX_EVENTS) throw new AiTrustError("invalid_output");
  const keys = new Set<string>();
  return events.map((event) => {
    if (format === "txt" || format === "md") {
      const evidence = strictText(event.evidence, MAX_EVIDENCE)!;
      if (!normalizedSource) throw new AiTrustError("source_changed");
      const first = normalizedSource.indexOf(evidence);
      if (first < 0 || normalizedSource.indexOf(evidence, first + evidence.length) >= 0) {
        throw new AiTrustError("invalid_output");
      }
      const line = normalizedSource.slice(0, first).split("\n").length;
      const structureKey = `${format}-line:${line}`;
      const identityKey = `${format}:${hash([structureKey, event.title, event.start, event.eventType])}`;
      if (keys.has(identityKey)) throw new AiTrustError("invalid_output");
      keys.add(identityKey);
      return { identityKind: "structure_semantic", identityKey, structureKey, identityEvidence: evidence, event };
    }
    const identityKey = `${format}:${hash([event.title, event.start, event.end, event.eventType])}`;
    if (keys.has(identityKey)) throw new AiTrustError("invalid_output");
    keys.add(identityKey);
    return {
      identityKind: "resolved_semantic",
      identityKey,
      structureKey: null,
      identityEvidence: "server-resolved normalized image extraction",
      event,
    };
  });
}
