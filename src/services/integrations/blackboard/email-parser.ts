import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeEmailText, type NormalizedInboundEmail } from "@/services/integrations/email/normalized-email";
import type { ParsedSchoolEvent, SchoolItemType, SchoolNotificationType } from "@/types/school-item";
import { parseEmailDeadline } from "./email-date";

export type BlackboardEmailPolicy = { senders: string[]; forwarders: string[]; hosts: string[]; timeZone: string };
export const normalizeSchoolKey = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function label(text: string, names: string): string | null {
  const match = text.match(new RegExp(`^(?:${names})[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, "im"));
  if (!match) return null;
  if (match[1].trim()) return match[1].trim();
  return text.slice(match.index! + match[0].length).trimStart().split("\n")[0]?.trim() || "";
}

/**
 * Extracts a base course code from a Blackboard course identifier shaped like:
 * <COURSE_CODE>_<SECTION>_<TERM> (e.g. "RZL110_A4_1Q2627" -> "RZL110").
 * Validates that the prefix looks like a plausible course code before using it,
 * and normalizes case and whitespace consistently.
 */
export function extractBaseCourseCode(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.normalize("NFKC").trim();
  if (!trimmed) return null;

  const parts = trimmed.split("_");
  if (parts.length < 3) return null;

  const [rawCode, section, term] = parts;
  if (!rawCode || !section || !term) return null;

  // Plausible course code: starts with 2-8 letters, followed by 1-5 digits, optional 0-3 alphanumeric suffix
  const courseCodePattern = /^[A-Za-z]{2,8}\d{1,5}[A-Za-z0-9]{0,3}$/;
  if (!courseCodePattern.test(rawCode)) return null;

  // Section and term must be non-empty alphanumeric tokens (with optional hyphens)
  const tokenPattern = /^[A-Za-z0-9-]+$/;
  if (!tokenPattern.test(section) || !tokenPattern.test(term)) return null;

  return rawCode.toUpperCase();
}

function extractLink(email: NormalizedInboundEmail, hosts: string[]): { ambiguous: boolean; link: { url: string; courseKey: string | null; sourceKey: string | null } | null } {
  const text = `${email.normalizedText}\n${normalizeEmailText("", email.html)}`;
  const rawUrls = [...text.matchAll(/https:\/\/[^\s<>"\]]+/gi)].map(m => m[0].replace(/[.,;)>\]]+$/, ""));
  let ambiguous = false;
  const links: Array<{ url: string; courseKey: string | null; sourceKey: string | null }> = [];

  for (const raw of rawUrls) {
    try {
      let url = new URL(raw);
      const initialHost = url.hostname.toLowerCase();

      // Check if wrapped in Outlook Safe Links
      const isSafeLink = initialHost === "safelinks.protection.outlook.com" || /^[a-z0-9-]+\.safelinks\.protection\.outlook\.com$/i.test(initialHost);
      if (isSafeLink) {
        const rawTarget = url.searchParams.get("url");
        if (!rawTarget) continue;
        let decodedTarget: string;
        try {
          decodedTarget = decodeURIComponent(rawTarget);
        } catch {
          continue; // Malformed percent encoding fails safely
        }
        let targetUrl: URL;
        try {
          targetUrl = new URL(decodedTarget);
        } catch {
          continue; // Malformed URL fails safely
        }
        if (targetUrl.protocol !== "https:") continue;
        if (targetUrl.username || targetUrl.password) continue;
        if (targetUrl.port && targetUrl.port !== "443") continue;
        if (!hosts.includes(targetUrl.hostname.toLowerCase())) continue;
        url = targetUrl;
      } else {
        if (!hosts.includes(initialHost) || url.username || url.password || (url.port && url.port !== "443") || url.protocol !== "https:") {
          continue;
        }
      }

      // Strip tracking query parameters
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|tracking|tracking_id|data|sdata|reserved)/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      url.searchParams.sort();

      // Handle nested Blackboard new_loc if present
      let nestedParams: URLSearchParams | null = null;
      const rawNewLoc = url.searchParams.get("new_loc");
      if (rawNewLoc) {
        let decodedLoc = rawNewLoc;
        if (decodedLoc.includes("%")) {
          try {
            decodedLoc = decodeURIComponent(decodedLoc);
          } catch {
            continue;
          }
        }
        if (!decodedLoc.startsWith("/") || decodedLoc.startsWith("//")) {
          continue;
        }
        try {
          const nestedUrl = new URL(decodedLoc, url.origin);
          if (nestedUrl.origin === url.origin) {
            nestedParams = nestedUrl.searchParams;
          }
        } catch {
          continue;
        }
      }

      // Extract course identifiers: both legacy course_id and modern Ultra courseId
      const directCourseId = url.searchParams.get("courseId");
      const directCourse_id = url.searchParams.get("course_id");
      const nestedCourseId = nestedParams?.get("courseId") ?? null;
      const nestedCourse_id = nestedParams?.get("course_id") ?? null;
      const pathCourse = url.pathname.match(/\/courses\/([^/]+)/)?.[1] ?? null;

      const courseCandidates = new Set(
        [directCourseId, directCourse_id, nestedCourseId, nestedCourse_id, pathCourse].filter((c): c is string => Boolean(c))
      );
      if (courseCandidates.size > 1) {
        ambiguous = true;
        continue;
      }
      const course = [...courseCandidates][0] ?? null;

      // Extract item identifiers: both legacy content_id and modern Ultra contentId
      const directContentId = url.searchParams.get("contentId");
      const directContent_id = url.searchParams.get("content_id");
      const nestedContentId = nestedParams?.get("contentId") ?? null;
      const nestedContent_id = nestedParams?.get("content_id") ?? null;

      const contentCandidates = new Set(
        [directContentId, directContent_id, nestedContentId, nestedContent_id].filter((c): c is string => Boolean(c))
      );
      if (contentCandidates.size > 1) {
        ambiguous = true;
        continue;
      }
      const contentId = [...contentCandidates][0] ?? null;

      const assessmentId = nestedParams?.get("assessment_id") ?? url.searchParams.get("assessment_id");
      const assignmentId = nestedParams?.get("assignment_id") ?? url.searchParams.get("assignment_id");
      const announcementId = nestedParams?.get("announcement_id") ?? url.searchParams.get("announcement_id");
      const pathItem = url.pathname.match(/\/(?:outline|assessments)\/([^/]+)/)?.[1];

      let itemKey: string | null = null;
      if (contentId) {
        itemKey = `content_id:${contentId}`;
      } else if (assessmentId) {
        itemKey = `assessment_id:${assessmentId}`;
      } else if (assignmentId) {
        itemKey = `assignment_id:${assignmentId}`;
      } else if (announcementId) {
        itemKey = `announcement_id:${announcementId}`;
      } else if (pathItem) {
        itemKey = pathItem;
      }

      const itemUrl = /\/(?:content|assignment|assessment|announcement|item|resource|quiz|exam)(?:\/|$)/i.test(url.pathname);
      const courseKey = course ? `${url.hostname}:${course}` : null;
      const sourceKey = itemKey ? `${url.hostname}:${itemKey}` : itemUrl ? `url:${url.toString()}` : null;

      links.push({
        url: url.toString(),
        courseKey,
        sourceKey,
      });
    } catch {
      continue;
    }
  }

  if (ambiguous) return { ambiguous: true, link: null };

  const strongItems = links.filter(l => l.sourceKey);
  if (new Set(strongItems.map(l => l.sourceKey)).size > 1) return { ambiguous: true, link: null };

  const strongCourses = links.filter(l => l.courseKey);
  if (new Set(strongCourses.map(l => l.courseKey)).size > 1) return { ambiguous: true, link: null };

  return { ambiguous: false, link: strongItems[0] ?? links[0] ?? null };
}

function classify(subject: string, text: string, structuralHeading?: string | null, candidateTitle?: string | null): { itemType: SchoolItemType; notificationType: SchoolNotificationType } {
  const explicit = label(text, "Item Type|Content Type|Type");
  const heading = `${subject}\n${explicit ?? ""}\n${structuralHeading ?? ""}\n${text.split("\n").slice(0, 3).join("\n")}`;
  let itemType: SchoolItemType = "unknown";
  let notificationType: SchoolNotificationType = "unknown";

  // Check for submission received
  if (/\b(?:assessment submitted|submission received)\b/i.test(`${subject}\n${structuralHeading ?? ""}`)) {
    notificationType = "submission_received";
    const titleOrText = `${candidateTitle ?? ""}\n${text}`;
    if (candidateTitle && /\bquiz\b/i.test(candidateTitle)) itemType = "quiz";
    else if (candidateTitle && /\b(exam|test)\b/i.test(candidateTitle)) itemType = "exam";
    else if (candidateTitle && /\bassignment\b/i.test(candidateTitle)) itemType = "assignment";
    else if (/\bquiz\b/i.test(titleOrText)) itemType = "quiz";
    else if (/\b(exam|test)\b/i.test(titleOrText)) itemType = "exam";
    else if (/\bassignment\b/i.test(titleOrText)) itemType = "assignment";
    return { itemType, notificationType };
  }

  // Check for grade updated
  if (/\b(?:new grade and feedback|grade updated|grade and feedback)\b/i.test(`${subject}\n${structuralHeading ?? ""}`)) {
    notificationType = "grade_updated";
    return { itemType: "unknown", notificationType };
  }

  // Informational headings take precedence over assignment words in prose.
  if (/\bannouncement\b/i.test(`${subject}\n${explicit ?? ""}`)) itemType = "announcement";
  else if (/\b(material|reading|lecture slides|resource|content available|content added|new content)\b/i.test(heading)) itemType = "material";
  else if (/\b(quiz)\b/i.test(heading)) itemType = "quiz";
  else if (/\b(exam|test)\b/i.test(heading)) itemType = "exam";
  else if (/\bassignment\b/i.test(heading)) itemType = "assignment";
  else if (/\bcourse (?:is now |has been )?(?:opened|available)\b/i.test(heading)) itemType = "course_opened";

  notificationType = itemType;
  if (itemType !== "announcement" && /\b(?:deadline|due date) (?:has been |was )?(?:changed|updated|extended)\b/i.test(heading)) notificationType = "deadline_changed";
  else if (itemType !== "announcement" && /\breminder\b/i.test(subject)) notificationType = "reminder";
  return { itemType, notificationType };
}

export function parseBlackboardEmail(email: NormalizedInboundEmail, policy: BlackboardEmailPolicy): ParsedSchoolEvent {
  const subject = email.subject.replace(/^(?:(?:fw|fwd|re):\s*)+/i, "").trim();
  let text = email.normalizedText;
  let sourceAt = email.sentAt;
  const base: ParsedSchoolEvent = {
    source: "blackboard", provider: email.provider, sourceMessageId: email.sourceMessageId,
    messageKey: digest(`${email.provider}:${email.sourceMessageId}`), receivedAt: email.receivedAt, sourceAt,
    parserVersion: "blackboard-email-v1", status: "ignored", notificationType: "unknown", itemType: "unknown",
    courseHint: null, baseCourseCode: null, courseKey: null, title: null, titleKey: null, sourceKey: null, sourceUrl: null,
    dueDate: null, dueAt: null, duePrecision: "none", weight: null, evidence: null, reason: "untrusted_sender",
  };
  if (!email.deliveryAuthenticated) return { ...base, reason: "unauthenticated_delivery" };
  if (!policy.senders.includes(email.sender)) {
    if (!policy.forwarders.includes(email.sender) || !email.forwarded) return base;
    const original = label(text, "From");
    const address = original?.match(/<([^<>]+)>\s*$/)?.[1] ?? original;
    if (!address || !z.email().safeParse(address).success || !policy.senders.includes(address.toLowerCase())) return base;
    // Only inspect the forwarded message, never the forwarder's introductory prose.
    text = text.slice(text.search(/^From:/im));
    const originalDate = label(text, "Sent|Date");
    sourceAt = originalDate && /(?:[+-]\d{2}:?\d{2}|GMT|UTC|Z)\s*$/i.test(originalDate) && Number.isFinite(Date.parse(originalDate))
      ? new Date(originalDate).toISOString() : null;
  }
  const forwardedSubject = email.forwarded ? label(text, "Subject") : null;
  const effectiveSubject = forwardedSubject ?? subject;

  // Detect Mapúa structural header format:
  // Line idx: COURSE_INSTANCE_CODE (matches extractBaseCourseCode)
  // Line idx + 1: COURSE DISPLAY NAME
  // Line idx + 2: NOTIFICATION HEADING
  // Line idx + 3: ITEM TITLE
  const nonBlankLines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const mapuaIdx = nonBlankLines.findIndex(l => extractBaseCourseCode(l) !== null);

  let mapuaCourseHeader: string | null = null;
  let mapuaNotificationHeading: string | null = null;
  let mapuaItemTitleLine: string | null = null;

  if (mapuaIdx !== -1 && mapuaIdx + 2 < nonBlankLines.length) {
    mapuaCourseHeader = nonBlankLines[mapuaIdx];
    mapuaNotificationHeading = nonBlankLines[mapuaIdx + 2] ?? null;
    mapuaItemTitleLine = nonBlankLines[mapuaIdx + 3] ?? null;
  }

  const courseHint = label(text, "Course|Course Name|Course Code") ?? mapuaCourseHeader;
  const baseCourseCode = extractBaseCourseCode(courseHint);

  const rawTitle = label(text, "Title|Item|Assignment|Quiz|Exam|Test|Material|Announcement")
    ?? effectiveSubject.match(/^(?:new\s+)?(?:assignment|quiz|exam|test|material|announcement)(?:\s+(?:posted|available|created))?\s*:\s*(.+)$/i)?.[1]?.trim()
    ?? mapuaItemTitleLine;

  let title = rawTitle;
  let extractedWeight: number | null = null;
  if (title) {
    const percentageMatch = title.match(/\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)$/);
    if (percentageMatch) {
      extractedWeight = Number(percentageMatch[1]);
      title = title.slice(0, percentageMatch.index).trim();
    }
  }

  const type = classify(effectiveSubject, text, mapuaNotificationHeading, title);
  const links = extractLink({ ...email, normalizedText: text }, policy.hosts);

  if (type.itemType === "course_opened" && !title) {
    title = courseHint;
  }

  const dueText = (type.notificationType === "deadline_changed" ? label(text, "New Due Date|New Deadline") : null)
    ?? label(text, "Due Date|Deadline|Due");
  const deadline = parseEmailDeadline(dueText, policy.timeZone);

  const weightText = label(text, "Weight|Grade Weight|Weighting");
  const weight = extractedWeight ?? (weightText?.match(/^(\d+(?:\.\d+)?)\s*%$/)?.[1] !== undefined ? Number(weightText.match(/^(\d+(?:\.\d+)?)\s*%$/)![1]) : undefined);

  const confirmationNumber = label(text, "Confirmation number|Confirmation Number");
  const evidence = [
    effectiveSubject,
    courseHint && `Course: ${courseHint}`,
    title && `Title: ${title}`,
    dueText !== null && `Due: ${dueText}`,
    confirmationNumber && `Confirmation: ${confirmationNumber}`,
  ].filter(Boolean).join("\n").slice(0, 2000);

  let status: ParsedSchoolEvent["status"] = "parsed";
  let reason: string | null = null;
  if (type.itemType === "unknown" && !["deadline_changed", "reminder", "submission_received", "grade_updated"].includes(type.notificationType)) {
    status = "unknown_type";
    reason = "unknown_notification";
  } else if (!title || title.length > 200 || (courseHint?.length ?? 0) > 300 || (links.link?.url.length ?? 0) > 2000 || (links.link?.courseKey?.length ?? 0) > 500 || (links.link?.sourceKey?.length ?? 0) > 2000 || links.ambiguous || deadline.duePrecision === "unresolved" || (weight !== undefined && Number(weight) > 100)) {
    status = "malformed";
    reason = "ambiguous_or_invalid_fields";
  } else if (type.notificationType === "deadline_changed" && (dueText === null || sourceAt === null)) {
    status = "malformed";
    reason = "missing_deadline_or_source_time";
  }

  // Cross-delivery retries share original Message-ID where available. Forwarded
  // copies also converge at the logical-item layer even when wrappers change IDs.
  const messageKey = digest(`${email.sender}:${email.originalMessageId ?? email.sourceMessageId}`);
  const courseKey = links.link?.courseKey ?? (courseHint ? `name:${normalizeSchoolKey(courseHint)}` : null);
  const sourceKey = links.link?.sourceKey ?? null;
  return { ...base, ...type, ...deadline, status, reason, sourceAt, messageKey,
    courseHint: courseHint?.slice(0, 300) ?? null,
    baseCourseCode,
    courseKey: (courseKey?.length ?? 0) <= 500 ? courseKey : null,
    title: title?.slice(0, 200) ?? null, titleKey: title ? normalizeSchoolKey(title).slice(0, 300) : null,
    sourceKey: (sourceKey?.length ?? 0) <= 2000 ? sourceKey : null,
    sourceUrl: (links.link?.url.length ?? 0) <= 2000 ? links.link?.url ?? null : null,
    weight: weight === undefined ? null : Number(weight), evidence };
}
