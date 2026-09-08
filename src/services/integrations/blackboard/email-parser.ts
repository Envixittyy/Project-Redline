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

function extractLink(email: NormalizedInboundEmail, hosts: string[]) {
  const text = `${email.normalizedText}\n${normalizeEmailText("", email.html)}`;
  const links = [...text.matchAll(/https:\/\/[^\s<>"\]]+/gi)].flatMap(match => {
    try {
      const url = new URL(match[0].replace(/[.,;)]+$/, ""));
      if (!hosts.includes(url.hostname.toLowerCase()) || url.username || url.password || (url.port && url.port !== "443")) return [];
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|tracking|tracking_id)/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      const course = url.searchParams.get("course_id") ?? url.pathname.match(/\/courses\/([^/]+)/)?.[1];
      const item = ["content_id", "assessment_id", "assignment_id", "announcement_id"].flatMap(key => {
        const id = url.searchParams.get(key); return id ? [`${key}:${id}`] : [];
      })[0] ?? url.pathname.match(/\/(?:outline|assessments)\/([^/]+)/)?.[1];
      const itemUrl = /\/(?:content|assignment|assessment|announcement|item|resource|quiz|exam)(?:\/|$)/i.test(url.pathname);
      return [{ url: url.toString(), courseKey: course ? `${url.hostname}:${course}` : null,
        sourceKey: item ? `${url.hostname}:${item}` : itemUrl ? `url:${url.toString()}` : null }];
    } catch { return []; }
  });
  const strong = links.filter(l => l.sourceKey);
  if (new Set(strong.map(l => l.sourceKey)).size > 1) return { ambiguous: true, link: null };
  return { ambiguous: false, link: strong[0] ?? links[0] ?? null };
}

function classify(subject: string, text: string): { itemType: SchoolItemType; notificationType: SchoolNotificationType } {
  const explicit = label(text, "Item Type|Content Type|Type");
  const heading = `${subject}\n${explicit ?? ""}\n${text.split("\n").slice(0, 3).join("\n")}`;
  let itemType: SchoolItemType = "unknown";
  // Informational headings take precedence over assignment words in prose.
  if (/\bannouncement\b/i.test(`${subject}\n${explicit ?? ""}`)) itemType = "announcement";
  else if (/\b(material|reading|lecture slides|resource|content available|content added)\b/i.test(heading)) itemType = "material";
  else if (/\b(quiz)\b/i.test(heading)) itemType = "quiz";
  else if (/\b(exam|test)\b/i.test(heading)) itemType = "exam";
  else if (/\bassignment\b/i.test(heading)) itemType = "assignment";
  else if (/\bcourse (?:is now |has been )?(?:opened|available)\b/i.test(heading)) itemType = "course_opened";
  let notificationType: SchoolNotificationType = itemType;
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
    courseHint: null, courseKey: null, title: null, titleKey: null, sourceKey: null, sourceUrl: null,
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
  const type = classify(effectiveSubject, text);
  const links = extractLink({ ...email, normalizedText: text }, policy.hosts);
  const courseHint = label(text, "Course|Course Name|Course Code");
  const title = label(text, "Title|Item|Assignment|Quiz|Exam|Test|Material|Announcement")
    ?? effectiveSubject.match(/^(?:new\s+)?(?:assignment|quiz|exam|test|material|announcement)(?:\s+(?:posted|available|created))?\s*:\s*(.+)$/i)?.[1]?.trim()
    ?? (type.itemType === "course_opened" ? courseHint : null);
  const dueText = (type.notificationType === "deadline_changed" ? label(text, "New Due Date|New Deadline") : null)
    ?? label(text, "Due Date|Deadline|Due");
  const deadline = parseEmailDeadline(dueText, policy.timeZone);
  const weightText = label(text, "Weight|Grade Weight|Weighting");
  const weight = weightText?.match(/^(\d+(?:\.\d+)?)\s*%$/)?.[1];
  const evidence = [effectiveSubject, courseHint && `Course: ${courseHint}`, title && `Title: ${title}`, dueText !== null && `Due: ${dueText}`].filter(Boolean).join("\n").slice(0, 2000);
  let status: ParsedSchoolEvent["status"] = "parsed";
  let reason: string | null = null;
  if (type.itemType === "unknown" && !["deadline_changed", "reminder"].includes(type.notificationType)) { status = "unknown_type"; reason = "unknown_notification"; }
  else if (!title || title.length > 200 || (courseHint?.length ?? 0) > 300 || (links.link?.url.length ?? 0) > 2000 || (links.link?.courseKey?.length ?? 0) > 500 || (links.link?.sourceKey?.length ?? 0) > 2000 || links.ambiguous || deadline.duePrecision === "unresolved" || (weight !== undefined && Number(weight) > 100)) { status = "malformed"; reason = "ambiguous_or_invalid_fields"; }
  else if (type.notificationType === "deadline_changed" && (dueText === null || sourceAt === null)) { status = "malformed"; reason = "missing_deadline_or_source_time"; }
  // Cross-delivery retries share original Message-ID where available. Forwarded
  // copies also converge at the logical-item layer even when wrappers change IDs.
  const messageKey = digest(`${email.sender}:${email.originalMessageId ?? email.sourceMessageId}`);
  const courseKey = links.link?.courseKey ?? (courseHint ? `name:${normalizeSchoolKey(courseHint)}` : null);
  const sourceKey = links.link?.sourceKey ?? null;
  return { ...base, ...type, ...deadline, status, reason, sourceAt, messageKey,
    courseHint: courseHint?.slice(0, 300) ?? null,
    courseKey: (courseKey?.length ?? 0) <= 500 ? courseKey : null,
    title: title?.slice(0, 200) ?? null, titleKey: title ? normalizeSchoolKey(title).slice(0, 300) : null,
    sourceKey: (sourceKey?.length ?? 0) <= 2000 ? sourceKey : null,
    sourceUrl: (links.link?.url.length ?? 0) <= 2000 ? links.link?.url ?? null : null,
    weight: weight === undefined ? null : Number(weight), evidence };
}
