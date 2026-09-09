import { createHash } from "node:crypto";

import ical, { type ParameterValue, type VEvent } from "node-ical";

const MAX_REPORT_EVENTS = 500;

type ValueShape = {
  present: boolean;
  length?: number;
  kind?: "date" | "date-time" | "number" | "text" | "uri";
  parameters?: string[];
};

export type BlackboardCalendarCharacterization = {
  schemaVersion: 1;
  calendar: {
    eventCount: number;
    productIdPresent: boolean;
    timeZonePresent: boolean;
    xProperties: string[];
  };
  events: Array<{
    ordinal: number;
    uid: ValueShape & { pattern?: string };
    summary: ValueShape;
    dtstart: ValueShape & { timeZone?: string | null };
    dtend: ValueShape & { timeZone?: string | null };
    url: ValueShape & { host?: string; pathShape?: string; queryKeys?: string[] };
    description: ValueShape & { lineCount?: number; labelKeys?: string[]; containsUrl?: boolean };
    location: ValueShape;
    categories: { count: number; valueShapes: string[] };
    sequence: ValueShape;
    lastModified: ValueShape;
    created: ValueShape;
    status: ValueShape;
    recurrenceId: ValueShape;
    recurrenceRule: ValueShape;
    xProperties: Array<{ name: string; shape: ValueShape }>;
    potentialCourseShapes: string[];
    potentialObjectIdShapes: string[];
    structuralHash: string;
  }>;
};

function parameterValue(value: ParameterValue | undefined): { text: string; parameters: string[] } {
  if (typeof value === "string") return { text: value, parameters: [] };
  if (value && typeof value === "object" && "val" in value) {
    return {
      text: String(value.val),
      parameters: Object.keys(value.params ?? {}).sort(),
    };
  }
  return { text: "", parameters: [] };
}

function textShape(value: unknown): ValueShape {
  if (value === undefined || value === null || value === "") return { present: false };
  const { text, parameters } = parameterValue(value as ParameterValue);
  return {
    present: true,
    length: text.length,
    kind: /^https?:\/\//i.test(text) ? "uri" : "text",
    ...(parameters.length ? { parameters } : {}),
  };
}

function dateShape(value: unknown): ValueShape & { timeZone?: string | null } {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) return { present: false };
  const date = value as Date & { dateOnly?: true; tz?: string };
  return {
    present: true,
    kind: date.dateOnly ? "date" : "date-time",
    timeZone: date.tz ?? null,
  };
}

function tokenShape(value: string): string {
  return value.normalize("NFKC")
    .replace(/[A-F0-9]{8}-[A-F0-9-]{27,}/gi, "<uuid>")
    .replace(/[A-Za-z]+/g, "<alpha>")
    .replace(/\d+/g, "<n>")
    .replace(/[^\s<>:/_.@-]+/g, "<symbol>")
    .slice(0, 120);
}

function uidPattern(value: string): string | undefined {
  if (!value) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "uuid-like";
  if (/^[^@\s]+@[^@\s]+$/.test(value)) return "local-part@host";
  if (/^https?:\/\//i.test(value)) return "uri";
  if (/^[A-Za-z0-9._:-]+$/.test(value)) return "opaque-token";
  return "mixed-text";
}

function safeUrlShape(value: unknown) {
  const shape = textShape(value) as ValueShape & {
    host?: string;
    pathShape?: string;
    queryKeys?: string[];
  };
  const raw = typeof value === "string" ? value : "";
  if (!shape.present) return shape;
  try {
    const parsed = new URL(raw);
    shape.host = parsed.hostname.toLowerCase();
    shape.pathShape = parsed.pathname
      .split("/")
      .map((part) => (part ? tokenShape(part) : part))
      .join("/")
      .slice(0, 200);
    shape.queryKeys = [...new Set(parsed.searchParams.keys())].sort().slice(0, 30);
  } catch {
    shape.kind = "text";
  }
  return shape;
}

function rawEventProperties(source: string): Array<Map<string, string[]>> {
  const lines = source.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const result: Array<Map<string, string[]>> = [];
  let current: Map<string, string[]> | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = new Map();
      continue;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (current) result.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const header = line.slice(0, separator);
    const name = header.split(";", 1)[0].toUpperCase();
    const params = header
      .split(";")
      .slice(1)
      .map((part) => part.split("=", 1)[0].toUpperCase())
      .sort();
    current.set(name, [...new Set([...(current.get(name) ?? []), ...params])]);
  }
  return result;
}

function rawShape(properties: Map<string, string[]>, name: string): ValueShape {
  if (!properties.has(name)) return { present: false };
  const parameters = properties.get(name) ?? [];
  return { present: true, ...(parameters.length ? { parameters } : {}) };
}

function descriptionShape(value: ParameterValue | undefined) {
  const { text, parameters } = parameterValue(value);
  if (!text) return { present: false } as ValueShape & {
    lineCount?: number;
    labelKeys?: string[];
    containsUrl?: boolean;
  };
  const labelKeys = [...text.matchAll(/^([A-Za-z][A-Za-z -]{0,40}):/gm)]
    .map((match) => match[1].trim().toLowerCase())
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 30);
  return {
    present: true,
    length: text.length,
    kind: "text" as const,
    ...(parameters.length ? { parameters } : {}),
    lineCount: text.split(/\r?\n/).length,
    labelKeys: labelKeys.map(tokenShape),
    containsUrl: /https?:\/\//i.test(text),
  };
}

function potentialShapes(event: VEvent, raw: Map<string, string[]>) {
  const summary = parameterValue(event.summary).text;
  const description = parameterValue(event.description).text;
  const categories = event.categories ?? [];
  const combined = [summary, description, ...categories].join("\n");
  const course = [...combined.matchAll(/\b[A-Z]{2,8}[ -]?\d{2,5}[A-Z]?\b/gi)]
    .map((match) => tokenShape(match[0].toUpperCase()));
  const objectIds = [...combined.matchAll(/(?:content|assessment|assignment|course)_id\s*[=:]\s*([^&\s]+)/gi)]
    .map((match) => `${match[0].split(/[=:]/, 1)[0].toLowerCase()}:<${uidPattern(match[1]) ?? "token"}>`);
  for (const name of raw.keys()) {
    if (/^X-.*(?:COURSE|CONTENT|ASSIGNMENT|ASSESSMENT|OBJECT).*ID/i.test(name)) {
      objectIds.push(`${name.toLowerCase()}:<opaque>`);
    }
  }
  return {
    potentialCourseShapes: [...new Set(course)].slice(0, 20),
    potentialObjectIdShapes: [...new Set(objectIds)].slice(0, 20),
  };
}

/**
 * Produces a values-redacted structural report. Raw UID, summary, description,
 * location, bearer URL path/query values, and source identifiers are omitted.
 */
export async function characterizeBlackboardCalendar(
  source: string,
): Promise<BlackboardCalendarCharacterization> {
  const parsed = await ical.async.parseICS(source);
  const events = Object.values(parsed).filter(
    (value): value is VEvent => Boolean(value && value.type === "VEVENT"),
  );
  const rawEvents = rawEventProperties(source);
  if (events.length > MAX_REPORT_EVENTS) throw new Error("Calendar contains too many events to characterize.");

  const reports = events.map((event, ordinal) => {
    const raw = rawEvents[ordinal] ?? new Map<string, string[]>();
    const uid = String(event.uid ?? "");
    const summary = textShape(event.summary);
    const url = safeUrlShape(event.url);
    const xProperties = [...raw.entries()]
      .filter(([name]) => name.startsWith("X-"))
      .map(([name, parameters]) => ({
        name,
        shape: { present: true, ...(parameters.length ? { parameters } : {}) },
      }));
    const potential = potentialShapes(event, raw);
    const report = {
      ordinal,
      uid: { ...textShape(uid), pattern: uidPattern(uid) },
      summary,
      dtstart: dateShape(event.start),
      dtend: dateShape(event.end),
      url,
      description: descriptionShape(event.description),
      location: textShape(event.location),
      categories: {
        count: event.categories?.length ?? 0,
        valueShapes: (event.categories ?? []).map(tokenShape).slice(0, 30),
      },
      sequence: event.sequence === undefined
        ? { present: false }
        : { present: true, kind: "number" as const },
      lastModified: dateShape(event.lastmodified),
      created: dateShape(event.created),
      status: textShape(event.status),
      recurrenceId: dateShape(event.recurrenceid),
      recurrenceRule: event.rrule
        ? { present: true, kind: "text" as const, length: event.rrule.toString().length }
        : rawShape(raw, "RRULE"),
      xProperties,
      ...potential,
    };
    return {
      ...report,
      structuralHash: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    };
  });

  const calendarXProperties = [...source.matchAll(/^(X-[A-Z0-9-]+)(?:;[^:]*)?:/gim)]
    .map((match) => match[1].toUpperCase())
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  return {
    schemaVersion: 1,
    calendar: {
      eventCount: reports.length,
      productIdPresent: Boolean(parsed.vcalendar?.prodid),
      timeZonePresent: Boolean(parsed.vcalendar?.["WR-TIMEZONE"]),
      xProperties: calendarXProperties,
    },
    events: reports,
  };
}
