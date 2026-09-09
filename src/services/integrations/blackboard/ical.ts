import { createHash } from "node:crypto";

import ical, { type CalendarResponse, type ParameterValue, type VEvent } from "node-ical";

import { addDays, isValidTimeZone, todayIn } from "@/lib/date/day";
import type { SchoolItemType } from "@/types/school-item";

import { normalizeFeedHostname } from "./safe-url";

const MAX_CALENDAR_BYTES = 2_000_000;
const MAX_EVENTS = 2_000;
const MAX_DESCRIPTION = 4_000;

export type DuePrecision = "none" | "date" | "instant" | "unresolved";

export type BlackboardFeedItem = {
  uid: string;
  title: string;
  titleKey: string;
  description: string | null;
  sourceUrl: string | null;
  candidateSourceKey: string | null;
  candidateCourseKey: string | null;
  courseCode: string | null;
  courseName: string | null;
  itemType: SchoolItemType;
  classificationReason: string | null;
  startsAt: string | null;
  dueAt: string | null;
  dueDate: string | null;
  duePrecision: DuePrecision;
  contentHash: string;
  proposalRevision: string;
  sourceUpdatedAt: string | null;
  sourceRevision: string | null;
  isFallbackUid: boolean;
  recurrence: boolean;
  status: string | null;
  rawMetadata: {
    parserVersion: "blackboard-calendar-v2";
    fields: string[];
    sequence: number | null;
    hasRecurrenceRule: boolean;
    hasRecurrenceId: boolean;
    xProperties: string[];
  };
};

export type BlackboardCalendarParseOptions = {
  allowedHosts: readonly string[];
  workspaceTimeZone: string;
};

export class BlackboardCalendarParseError extends Error {
  constructor(
    readonly code: "calendar_too_large" | "invalid_calendar" | "too_many_events" | "invalid_event",
    message: string,
  ) {
    super(message);
    this.name = "BlackboardCalendarParseError";
  }
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizedKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

function textValue(value: ParameterValue | undefined): string | null {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object" && "val" in value
      ? String(value.val)
      : "";
  const normalized = raw.normalize("NFKC").trim();
  return normalized || null;
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function classifyItem(event: VEvent, title: string) {
  const categoryTypes = new Set<SchoolItemType>();
  for (const category of event.categories ?? []) {
    const token = normalizedKey(category);
    if (/^(assignment|assignments)$/.test(token)) categoryTypes.add("assignment");
    if (/^(quiz|quizzes)$/.test(token)) categoryTypes.add("quiz");
    if (/^(exam|examination|test|tests)$/.test(token)) categoryTypes.add("exam");
  }
  if (categoryTypes.size > 1) {
    return { itemType: "unknown" as const, reason: "conflicting_type_categories" };
  }
  if (categoryTypes.size === 1) {
    return { itemType: [...categoryTypes][0], reason: "category" };
  }

  const heading = title.toLowerCase();
  const matches = new Set<SchoolItemType>();
  if (/\bassignment\b/.test(heading)) matches.add("assignment");
  if (/\bquiz\b/.test(heading)) matches.add("quiz");
  if (/\b(exam|examination|test)\b/.test(heading)) matches.add("exam");
  if (matches.size === 1) return { itemType: [...matches][0], reason: "summary" };
  return {
    itemType: "unknown" as const,
    reason: matches.size > 1 ? "conflicting_type_summary" : "unsupported_type",
  };
}

function courseHints(event: VEvent, title: string, description: string | null) {
  const typeWords = /^(assignment|assignments|quiz|quizzes|exam|examination|test|tests)$/i;
  const categories = (event.categories ?? [])
    .map(normalizeText)
    .filter((value) => value && !typeWords.test(value));
  const described = description?.match(/^Course(?: Name| Code)?\s*:\s*(.+)$/im)?.[1];
  const bracketed = title.match(/^\[([^\]]{2,100})\]/)?.[1];
  const candidates = [...new Set([described, ...categories, bracketed].filter(Boolean).map((value) => normalizeText(value!)))];
  if (candidates.length !== 1) {
    return { courseCode: null, courseName: null, ambiguous: candidates.length > 1 };
  }
  const hint = candidates[0];
  const looksLikeCode = /^[A-Z]{2,8}[ -]?\d{2,5}[A-Z]?$/i.test(hint);
  return {
    courseCode: looksLikeCode ? hint.toUpperCase().replace(/\s+/g, " ") : null,
    courseName: looksLikeCode ? null : hint.slice(0, 300),
    ambiguous: false,
  };
}

function sanitizeSourceUrl(value: string | undefined, allowedHosts: readonly string[]) {
  if (!value) return { sourceUrl: null, sourceKey: null, courseKey: null };
  try {
    const url = new URL(value);
    const hostname = normalizeFeedHostname(url.hostname);
    const allowed = allowedHosts.map(normalizeFeedHostname);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !allowed.includes(hostname)
    ) {
      return { sourceUrl: null, sourceKey: null, courseKey: null };
    }
    const retainedQueryKeys = new Set([
      "course_id",
      "content_id",
      "assessment_id",
      "assignment_id",
      "announcement_id",
    ]);
    for (const key of [...url.searchParams.keys()]) {
      if (!retainedQueryKeys.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const courseId = url.searchParams.get("course_id") ?? url.pathname.match(/\/courses\/([^/]+)/)?.[1];
    const item = ["content_id", "assessment_id", "assignment_id", "announcement_id"]
      .map((key) => [key, url.searchParams.get(key)] as const)
      .find(([, id]) => Boolean(id));
    const pathId = url.pathname.match(/\/(?:outline|assessments)\/([^/]+)/)?.[1];
    const itemUrl = /\/(?:content|assignment|assessment|announcement|item|resource|quiz|exam)(?:\/|$)/i.test(url.pathname);
    const sourceKey = item
      ? `${hostname}:${item[0]}:${item[1]}`
      : pathId
        ? `${hostname}:${pathId}`
        : itemUrl
          ? `url:${url.toString()}`
          : null;
    return {
      sourceUrl: url.toString().slice(0, 2_000),
      sourceKey,
      courseKey: courseId ? `${hostname}:${courseId}` : null,
    };
  } catch {
    return { sourceUrl: null, sourceKey: null, courseKey: null };
  }
}

function eventTimeZone(parsed: CalendarResponse, event: VEvent, workspaceTimeZone: string) {
  const candidate = event.start?.tz ?? parsed.vcalendar?.["WR-TIMEZONE"];
  return candidate && isValidTimeZone(candidate) ? candidate : workspaceTimeZone;
}

type RawTemporal = { start: string | null; end: string | null };

function rawTemporalProperties(source: string): RawTemporal[] {
  const result: RawTemporal[] = [];
  let current: RawTemporal | null = null;
  for (const line of source.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = { start: null, end: null };
      continue;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (current) result.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    if (/^DTSTART(?:;|:)/i.test(line) && current.start === null) current.start = line;
    if (/^DTEND(?:;|:)/i.test(line) && current.end === null) current.end = line;
  }
  return result;
}

function rawDateOnly(line: string | null): string | null {
  const match = line?.match(/(?:^|;)VALUE=DATE(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})$/i)
    ?? line?.match(/^DTSTART:(\d{4})(\d{2})(\d{2})$/i);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function isUnambiguousDateTime(line: string | null): boolean {
  return Boolean(line && (/;TZID=[^:;]+(?:;[^:]*)?:/i.test(line) || /:\d{8}T\d{6}Z$/i.test(line)));
}

function dateFields(
  parsed: CalendarResponse,
  event: VEvent,
  workspaceTimeZone: string,
  raw: RawTemporal,
) {
  const zone = eventTimeZone(parsed, event, workspaceTimeZone);
  const start = event.start instanceof Date && Number.isFinite(event.start.valueOf())
    ? event.start
    : null;
  const end = event.end instanceof Date && Number.isFinite(event.end.valueOf())
    ? event.end
    : null;
  const isDate = event.datetype === "date" || Boolean(start?.dateOnly);
  if (!start) {
    const endDate = rawDateOnly(raw.end);
    if (endDate) {
      return {
        startsAt: null,
        dueAt: null,
        dueDate: addDays(endDate, -1),
        duePrecision: "date" as const,
      };
    }
    if (end && isUnambiguousDateTime(raw.end)) {
      return {
        startsAt: null,
        dueAt: end.toISOString(),
        dueDate: todayIn(workspaceTimeZone, end),
        duePrecision: "instant" as const,
      };
    }
    return { startsAt: null, dueAt: null, dueDate: null, duePrecision: "unresolved" as const };
  }
  if (isDate) {
    return {
      startsAt: null,
      dueAt: null,
      dueDate: rawDateOnly(raw.start) ?? todayIn(zone, start),
      duePrecision: "date" as const,
    };
  }
  const deadlineLine = raw.end ?? raw.start;
  if (!isUnambiguousDateTime(deadlineLine)) {
    return { startsAt: null, dueAt: null, dueDate: null, duePrecision: "unresolved" as const };
  }
  const deadline = raw.end ? end ?? start : start;
  return {
    startsAt: start.toISOString(),
    dueAt: deadline.toISOString(),
    dueDate: todayIn(workspaceTimeZone, deadline),
    duePrecision: "instant" as const,
  };
}

function sourceDate(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.valueOf()) ? value.toISOString() : null;
}

function xProperties(event: VEvent): string[] {
  const known = new Set([
    "type", "uid", "dtstamp", "created", "lastmodified", "sequence", "summary",
    "description", "location", "categories", "url", "start", "datetype", "end",
    "status", "rrule", "recurrenceid", "recurrences", "exdate", "alarms", "method",
    "transparency", "class", "organizer", "attendee", "geo", "completion",
  ]);
  return Object.keys(event)
    .filter((key) => !known.has(key))
    .map((key) => `X-${key.toUpperCase()}`)
    .sort();
}

export function computeProposalRevision(input: {
  title: string;
  description: string | null;
  dueDate: string | null;
  dueAt: string | null;
  duePrecision: DuePrecision;
  courseCode: string | null;
}): string {
  return canonicalDigest({
    schemaVersion: 2,
    courseCode: input.courseCode ? normalizeText(input.courseCode) : null,
    description: input.description?.trim() || null,
    dueAt: input.dueAt,
    dueDate: input.dueDate,
    duePrecision: input.duePrecision,
    title: normalizeText(input.title),
  });
}

export async function parseBlackboardICalendar(
  source: string,
  options: BlackboardCalendarParseOptions = {
    allowedHosts: [],
    workspaceTimeZone: "Asia/Manila",
  },
): Promise<BlackboardFeedItem[]> {
  if (Buffer.byteLength(source, "utf8") > MAX_CALENDAR_BYTES) {
    throw new BlackboardCalendarParseError("calendar_too_large", "Calendar feed is too large.");
  }
  if (!/^BEGIN:VCALENDAR\r?$/im.test(source) || !/^END:VCALENDAR\r?$/im.test(source)) {
    throw new BlackboardCalendarParseError("invalid_calendar", "Blackboard returned an invalid calendar.");
  }

  let parsed: CalendarResponse;
  try {
    parsed = await ical.async.parseICS(source);
  } catch {
    throw new BlackboardCalendarParseError("invalid_calendar", "Blackboard returned a malformed calendar.");
  }
  const events = Object.values(parsed).filter(
    (value): value is VEvent => Boolean(value && value.type === "VEVENT"),
  );
  if (events.length > MAX_EVENTS) {
    throw new BlackboardCalendarParseError("too_many_events", "Calendar contains too many events.");
  }

  const seenUids = new Set<string>();
  const items: BlackboardFeedItem[] = [];
  const rawTemporals = rawTemporalProperties(source);
  for (const [eventIndex, event] of events.entries()) {
    const uid = normalizeText(String(event.uid ?? ""));
    const title = normalizeText(textValue(event.summary) ?? "");
    if (!uid || uid.length > 2_000 || !title || title.length > 200) {
      throw new BlackboardCalendarParseError("invalid_event", "Calendar contains an invalid event.");
    }
    if (seenUids.has(uid)) continue;
    seenUids.add(uid);

    const rawDescription = textValue(event.description);
    if ((rawDescription?.length ?? 0) > MAX_DESCRIPTION) {
      throw new BlackboardCalendarParseError("invalid_event", "Calendar event description is too large.");
    }
    const description = rawDescription || null;
    const url = sanitizeSourceUrl(event.url, options.allowedHosts);
    const course = courseHints(event, title, description);
    const classification = classifyItem(event, title);
    const temporal = dateFields(
      parsed,
      event,
      options.workspaceTimeZone,
      rawTemporals[eventIndex] ?? { start: null, end: null },
    );
    const sourceUpdatedAt = sourceDate(event.lastmodified) ?? sourceDate(event.dtstamp);
    const sourceRevision = event.sequence !== undefined || sourceUpdatedAt
      ? `sequence:${event.sequence ?? "none"};modified:${sourceUpdatedAt ?? "none"}`
      : null;
    const recurrence = Boolean(event.rrule || event.recurrenceid);
    const status = event.status ? String(event.status) : null;
    const fields = [
      event.uid && "uid", event.summary && "summary", event.description && "description",
      event.start && "dtstart", event.end && "dtend", event.url && "url",
      event.location && "location", event.categories?.length && "categories",
      event.sequence !== undefined && "sequence", event.lastmodified && "last-modified",
      event.created && "created", event.status && "status", event.rrule && "rrule",
      event.recurrenceid && "recurrence-id",
    ].filter((value): value is string => Boolean(value));
    const rawMetadata = {
      parserVersion: "blackboard-calendar-v2" as const,
      fields,
      sequence: event.sequence ?? null,
      hasRecurrenceRule: Boolean(event.rrule),
      hasRecurrenceId: Boolean(event.recurrenceid),
      xProperties: xProperties(event),
    };
    const itemType = recurrence || status === "CANCELLED" ? "unknown" : classification.itemType;
    const classificationReason = recurrence
      ? "recurrence_not_supported"
      : status === "CANCELLED"
        ? "cancelled_observation"
        : course.ambiguous
          ? "ambiguous_course_hint"
          : classification.reason;
    const contentHash = canonicalDigest({
      schemaVersion: 2,
      uid,
      title,
      description,
      sourceUrl: url.sourceUrl,
      candidateSourceKey: url.sourceKey,
      candidateCourseKey: url.courseKey,
      courseCode: course.courseCode,
      courseName: course.courseName,
      itemType,
      ...temporal,
      sourceUpdatedAt,
      sourceRevision,
      status,
      recurrence,
    });
    const proposalRevision = computeProposalRevision({
      title,
      description,
      dueDate: temporal.dueDate,
      dueAt: temporal.dueAt,
      duePrecision: temporal.duePrecision,
      courseCode: course.courseCode,
    });
    items.push({
      uid,
      title,
      titleKey: normalizedKey(title).slice(0, 300),
      description,
      sourceUrl: url.sourceUrl,
      candidateSourceKey: url.sourceKey,
      candidateCourseKey: url.courseKey,
      courseCode: course.courseCode,
      courseName: course.courseName,
      itemType,
      classificationReason,
      ...temporal,
      contentHash,
      proposalRevision,
      sourceUpdatedAt,
      sourceRevision,
      isFallbackUid: false,
      recurrence,
      status,
      rawMetadata,
    });
  }
  return items;
}
