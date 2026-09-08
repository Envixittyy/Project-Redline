import { describe, expect, it } from "vitest";
import { normalizePostmarkEmail, verifyPostmarkAuthorization } from "../email/postmark";
import { parseBlackboardEmail } from "./email-parser";
import { parseEmailDeadline } from "./email-date";
import { assignmentEmail, deadlineEmail, emailPolicy, forwardedEmail, reminderEmail } from "./fixtures/email-fixtures";

const parse = (payload: unknown) => parseBlackboardEmail(normalizePostmarkEmail(payload, "2026-09-08T02:01:00.000Z"), emailPolicy);
describe("Blackboard email parser", () => {
  it("extracts precise assignment fields and strips tracking without losing identity", () => {
    expect(parse(assignmentEmail())).toMatchObject({ status: "parsed", itemType: "assignment", title: "Assignment 1", courseHint: "CS101", dueDate: "2026-09-15", dueAt: "2026-09-15T15:59:00.000Z", weight: 15, courseKey: "learn.example.edu:_101_1", sourceKey: "learn.example.edu:content_id:_201_1" });
    expect(parse(assignmentEmail()).sourceUrl).not.toContain("utm_");
  });
  it("recognizes reminders, deadline changes, normal forwarding and redirects", () => {
    expect(parse(reminderEmail()).notificationType).toBe("reminder");
    expect(parse(deadlineEmail())).toMatchObject({ notificationType: "deadline_changed", dueDate: "2026-09-18" });
    expect(parse(forwardedEmail())).toMatchObject({ status: "parsed", title: "Assignment 1", sourceAt: "2026-09-08T02:00:00.000Z" });
    expect(parse(assignmentEmail({ Headers: [...assignmentEmail().Headers, { Name: "Resent-From", Value: "student@example.edu" }] })).status).toBe("parsed");
  });
  it("prefers the explicit new deadline when a change includes the previous deadline first", () => {
    expect(parse({ ...deadlineEmail(), TextBody: assignmentEmail().TextBody + "\nNew Due Date: September 18, 2026 at 11:59 PM Asia/Manila" })).toMatchObject({ notificationType: "deadline_changed", dueDate: "2026-09-18" });
  });
  it.each(["Quiz", "Exam", "Test", "Material", "Announcement"])("classifies %s", type => {
    const result = parse(assignmentEmail({ Subject: `${type}: Week 1`, TextBody: `Course: CS101\nItem Type: ${type}\nTitle: Week 1` }));
    expect(result.itemType).toBe(type === "Test" ? "exam" : type.toLowerCase());
  });
  it("recognizes course opened without manufacturing a course or deadline", () => {
    expect(parse(assignmentEmail({ Subject: "Course is now available", TextBody: "Course: CS101" }))).toMatchObject({ itemType: "course_opened", title: "CS101", duePrecision: "none" });
  });
  it("handles HTML entities, table structure, and HTML-only links", () => {
    const result = parse(assignmentEmail({ TextBody: "", HtmlBody: '<p>Course: CS101</p><p>Item Type: Assignment</p><p>Title: Read &amp; reflect</p><p>Due Date: 2026-09-15</p><a href="https://learn.example.edu/item?course_id=_101_1&amp;content_id=_201_1">Open</a>' }));
    expect(result).toMatchObject({ status: "parsed", title: "Read & reflect", duePrecision: "date", dueAt: null, sourceKey: "learn.example.edu:content_id:_201_1" });
  });
  it("keeps missing date and URL optional", () => {
    expect(parse(assignmentEmail({ TextBody: "Course: CS101\nTitle: Assignment 1" }))).toMatchObject({ status: "parsed", sourceUrl: null, dueDate: null, dueAt: null });
  });
  it("rejects malformed dates, multiple item links and unknown messages safely", () => {
    expect(parse(assignmentEmail({ TextBody: "Course: CS101\nTitle: Assignment 1\nDue Date: tomorrow-ish" })).status).toBe("malformed");
    expect(parse(assignmentEmail({ TextBody: assignmentEmail().TextBody + "\nhttps://learn.example.edu/item?course_id=_101_1&content_id=_999_1" })).status).toBe("malformed");
    expect(parse(assignmentEmail({ Subject: "Blackboard digest", TextBody: "Something changed." })).status).toBe("unknown_type");
  });
  it("does not treat unrelated, spoofed, or untrusted forwarded messages as School", () => {
    expect(parse(assignmentEmail({ FromFull: { Email: "attacker@example.net" } })).status).toBe("ignored");
    expect(parse(assignmentEmail({ Headers: [] })).reason).toBe("unauthenticated_delivery");
    expect(parse(forwardedEmail()).status).toBe("parsed");
    expect(parse({ ...forwardedEmail(), TextBody: forwardedEmail().TextBody.replace("notifications@learn.example.edu", "fake@example.net") }).status).toBe("ignored");
    expect(parse(assignmentEmail({ Headers: [...assignmentEmail().Headers, assignmentEmail().Headers[1]] })).status).toBe("ignored");
  });
  it("does not turn assignment prose inside an announcement into a task", () => {
    expect(parse(assignmentEmail({ Subject: "Announcement: Assignment expectations" })).itemType).toBe("announcement");
  });
  it("verifies Basic authorization and refuses absent or short credentials", () => {
    const password = "x".repeat(32);
    const header = `Basic ${Buffer.from(`school:${password}`).toString("base64")}`;
    expect(verifyPostmarkAuthorization(header, "school", password)).toBe(true);
    expect(verifyPostmarkAuthorization(header, "school", "wrong")).toBe(false);
    expect(verifyPostmarkAuthorization(null, "school", password)).toBe(false);
  });
});

describe("explicit email deadlines", () => {
  it.each(["2026-02-30", "09/10/26", "next Friday", "2026-09-10 25:00", "2026-09-10 11:59 PM PST", "2026-09-10T12:00+15:00", "2026-09-10 00:30 PM"])("fails closed for %s", value => {
    expect(parseEmailDeadline(value, "Asia/Manila").duePrecision).toBe("unresolved");
  });
  it("preserves date-only, explicit offset, and configured local clock semantics", () => {
    expect(parseEmailDeadline("2026-09-15", "Asia/Manila")).toEqual({ dueDate: "2026-09-15", dueAt: null, duePrecision: "date" });
    expect(parseEmailDeadline("2026-09-15T23:59-04:00", "Asia/Manila").dueAt).toBe("2026-09-16T03:59:00.000Z");
    expect(parseEmailDeadline("2026-09-15 23:59", "Asia/Manila").dueAt).toBe("2026-09-15T15:59:00.000Z");
    expect(parseEmailDeadline("2026-03-08 02:30 America/New_York", "Asia/Manila").duePrecision).toBe("unresolved");
  });
});
