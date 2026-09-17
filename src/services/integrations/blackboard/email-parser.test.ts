import { describe, expect, it } from "vitest";
import { normalizePostmarkEmail, verifyPostmarkAuthorization } from "../email/postmark";
import { extractBaseCourseCode, parseBlackboardEmail } from "./email-parser";
import { parseEmailDeadline } from "./email-date";
import {
  assignmentEmail,
  deadlineEmail,
  emailPolicy,
  forwardedEmail,
  mapuaPolicy,
  newContentEmail,
  newGradeAndFeedbackEmail,
  reminderEmail,
  submissionReceivedEmail,
} from "./fixtures/email-fixtures";

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

describe("base course code extraction", () => {
  it.each([
    ["RZL110_A4_1Q2627", "RZL110"],
    ["MATH177_E06_1Q2627", "MATH177"],
    ["GED107_C2_1Q2627", "GED107"],
    ["rzl110_a4_1q2627", "RZL110"],
    ["  MATH177_E06_1Q2627  ", "MATH177"],
    ["RZL11_A4_1Q2627", "RZL11"],
    ["CS101_A1_1Q2627", "CS101"],
    ["IT114L_BM1_2Q2627", "IT114L"],
  ])("extracts base course code from %s -> %s", (input, expected) => {
    expect(extractBaseCourseCode(input)).toBe(expected);
  });

  it.each([
    "announcement_about_exam",
    "some_arbitrary_string",
    "MATH177_E06",
    "CS101",
    "",
    "   ",
    "123_A1_1Q26",
    null,
    undefined,
  ])("rejects non-course-code or invalid strings: %s", (input) => {
    expect(extractBaseCourseCode(input as string)).toBeNull();
  });

  it("extracts baseCourseCode in parseBlackboardEmail", () => {
    const result = parse(assignmentEmail({ TextBody: "Course: RZL110_A4_1Q2627\nTitle: Reading 1" }));
    expect(result).toMatchObject({
      status: "parsed",
      courseHint: "RZL110_A4_1Q2627",
      baseCourseCode: "RZL110",
    });
  });
});

describe("Mapúa Production Blackboard Templates", () => {
  const parseMapua = (payload: unknown) => parseBlackboardEmail(normalizePostmarkEmail(payload, "2026-09-17T11:00:00.000Z"), mapuaPolicy);

  describe("Template A — Submission Confirmation", () => {
    it("recognizes Submission received and maps Assessment submitted to submission_received", () => {
      const result = parseMapua(submissionReceivedEmail());
      expect(result.status).toBe("parsed");
      expect(result.notificationType).toBe("submission_received");
    });

    it("extracts Synthesis Quiz 2 (10%) into title Synthesis Quiz 2, weight 10, and quiz itemType", () => {
      const result = parseMapua(submissionReceivedEmail());
      expect(result.title).toBe("Synthesis Quiz 2");
      expect(result.weight).toBe(10);
      expect(result.itemType).toBe("quiz");
    });

    it("extracts course header and baseCourseCode GED107", () => {
      const result = parseMapua(submissionReceivedEmail());
      expect(result.courseHint).toBe("GED107_C2_1Q2627");
      expect(result.baseCourseCode).toBe("GED107");
    });

    it("extracts nested courseId and contentId from new_loc URL", () => {
      const result = parseMapua(submissionReceivedEmail());
      expect(result.courseKey).toBe("mapua.blackboard.com:_165894_1");
      expect(result.sourceKey).toBe("mapua.blackboard.com:content_id:_6827441_1");
      expect(result.sourceUrl).toContain("mapua.blackboard.com/webapps/login/?action=login&new_loc=");
    });

    it("does not interpret bare PST as US Pacific time or populate due date fields", () => {
      const result = parseMapua(submissionReceivedEmail());
      expect(result.dueDate).toBeNull();
      expect(result.dueAt).toBeNull();
      expect(result.duePrecision).toBe("none");
      // Uses authenticated sentAt for sourceAt
      expect(result.sourceAt).toBe("2026-09-17T11:00:00.000Z");
    });

    it("captures confirmation number in evidence", () => {
      const result = parseMapua(submissionReceivedEmail());
      expect(result.evidence).toContain("Confirmation: 54d298eb0e594da3b418696f89b7e0d4");
    });

    it("does not strip non-percentage parentheses from legitimate titles", () => {
      const email = submissionReceivedEmail({
        TextBody: submissionReceivedEmail().TextBody.replace("Synthesis Quiz 2 (10%)", "Synthesis Quiz 2 (Part A)"),
      });
      const result = parseMapua(email);
      expect(result.title).toBe("Synthesis Quiz 2 (Part A)");
      expect(result.weight).toBeNull();
    });
  });

  describe("Template B — New Course Content", () => {
    it("classifies New content as material with title and no Task", () => {
      const result = parseMapua(newContentEmail());
      expect(result.status).toBe("parsed");
      expect(result.notificationType).toBe("material");
      expect(result.itemType).toBe("material");
    });

    it("resolves course header and baseCourseCode RZL110", () => {
      const result = parseMapua(newContentEmail());
      expect(result.courseHint).toBe("RZL110_A4_1Q2627");
      expect(result.baseCourseCode).toBe("RZL110");
    });

    it("extracts PDF title exactly", () => {
      const result = parseMapua(newContentEmail());
      expect(result.title).toBe("Ikapitong Linggo - Si Rizal at Ang Noli Me Tangere.pdf");
      expect(result.weight).toBeNull();
    });

    it("unwraps Safe Links wrapper and extracts canonical contentId as stable identity", () => {
      const result = parseMapua(newContentEmail());
      expect(result.courseKey).toBe("mapua.blackboard.com:_165958_1");
      expect(result.sourceKey).toBe("mapua.blackboard.com:content_id:_7043773_1");
      expect(result.sourceUrl).not.toContain("safelinks.protection.outlook.com");
      expect(result.sourceUrl).toContain("mapua.blackboard.com");
    });
  });

  describe("Template C — New Grade and Feedback", () => {
    it("maps New grade and feedback to grade_updated and unknown itemType without guessing", () => {
      const result = parseMapua(newGradeAndFeedbackEmail());
      expect(result.status).toBe("parsed");
      expect(result.notificationType).toBe("grade_updated");
      expect(result.itemType).toBe("unknown");
    });

    it("resolves course header and baseCourseCode MATH177", () => {
      const result = parseMapua(newGradeAndFeedbackEmail());
      expect(result.courseHint).toBe("MATH177_E06_1Q2627");
      expect(result.baseCourseCode).toBe("MATH177");
    });

    it("extracts title without generic Assessment label", () => {
      const result = parseMapua(newGradeAndFeedbackEmail());
      expect(result.title).toBe("Calculus through Data & Modelling: Series and Integration");
      expect(result.weight).toBeNull();
    });

    it("unwraps Safe Links and extracts courseId and contentId", () => {
      const result = parseMapua(newGradeAndFeedbackEmail());
      expect(result.courseKey).toBe("mapua.blackboard.com:_164519_1");
      expect(result.sourceKey).toBe("mapua.blackboard.com:content_id:_6996549_1");
      expect(result.dueDate).toBeNull();
      expect(result.dueAt).toBeNull();
    });
  });

  describe("Outlook Safe Links & Nested new_loc Unwrapping", () => {
    it("unwraps Outlook Safe Links wrapper to original trusted Blackboard URL", () => {
      const direct = parseMapua({
        ...newContentEmail(),
        TextBody: newContentEmail().TextBody.replace(
          /https:\/\/nam12\.safelinks[^\s]+/g,
          "https://mapua.blackboard.com/webapps/login/?action=login&new_loc=%2Fultra%2Fredirect%3FcourseId%3D_165958_1%26contentId%3D_7043773_1",
        ),
      });
      const wrapped = parseMapua(newContentEmail());

      expect(wrapped.courseKey).toBe(direct.courseKey);
      expect(wrapped.sourceKey).toBe(direct.sourceKey);
      expect(wrapped.sourceKey).toBe("mapua.blackboard.com:content_id:_7043773_1");
    });

    it("course_id and courseId normalize consistently", () => {
      const withSnake = parseMapua(assignmentEmail({
        TextBody: "Course: CS101\nTitle: Test\nhttps://mapua.blackboard.com/item?course_id=_101_1&content_id=_201_1",
      }));
      const withCamel = parseMapua(assignmentEmail({
        TextBody: "Course: CS101\nTitle: Test\nhttps://mapua.blackboard.com/webapps/login/?action=login&new_loc=%2Fultra%2Fredirect%3FcourseId%3D_101_1%26contentId%3D_201_1",
      }));

      expect(withSnake.courseKey).toBe("mapua.blackboard.com:_101_1");
      expect(withCamel.courseKey).toBe("mapua.blackboard.com:_101_1");
      expect(withSnake.courseKey).toBe(withCamel.courseKey);
    });

    it("content_id and contentId normalize consistently", () => {
      const withSnake = parseMapua(assignmentEmail({
        TextBody: "Course: CS101\nTitle: Test\nhttps://mapua.blackboard.com/item?content_id=_7043773_1",
      }));
      const withCamel = parseMapua(assignmentEmail({
        TextBody: "Course: CS101\nTitle: Test\nhttps://mapua.blackboard.com/webapps/login/?action=login&new_loc=%2Fultra%2Fredirect%3FcontentId%3D_7043773_1",
      }));

      expect(withSnake.sourceKey).toBe("mapua.blackboard.com:content_id:_7043773_1");
      expect(withCamel.sourceKey).toBe("mapua.blackboard.com:content_id:_7043773_1");
      expect(withSnake.sourceKey).toBe(withCamel.sourceKey);
    });

    it("rejects Safe Links pointing to untrusted inner host", () => {
      const email = assignmentEmail({
        TextBody: "Course: CS101\nTitle: Phish\nhttps://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fevil.attacker.com%2Fitem%3Fcontent_id%3D_999_1",
      });
      const result = parseMapua(email);
      expect(result.sourceKey).toBeNull();
      expect(result.sourceUrl).toBeNull();
    });

    it("rejects non-HTTPS inner destinations", () => {
      const email = assignmentEmail({
        TextBody: "Course: CS101\nTitle: Insecure\nhttps://nam12.safelinks.protection.outlook.com/?url=http%3A%2F%2Fmapua.blackboard.com%2Fitem%3Fcontent_id%3D_999_1",
      });
      const result = parseMapua(email);
      expect(result.sourceKey).toBeNull();
      expect(result.sourceUrl).toBeNull();
    });

    it("rejects embedded credentials in Safe Links target", () => {
      const email = assignmentEmail({
        TextBody: "Course: CS101\nTitle: Creds\nhttps://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fuser%3Apass%40mapua.blackboard.com%2Fitem%3Fcontent_id%3D_999_1",
      });
      const result = parseMapua(email);
      expect(result.sourceKey).toBeNull();
      expect(result.sourceUrl).toBeNull();
    });

    it("malformed encoded url fails safely without throwing", () => {
      const email = assignmentEmail({
        TextBody: "Course: CS101\nTitle: Malformed\nhttps://nam12.safelinks.protection.outlook.com/?url=%ZZ%FFinvalid",
      });
      const result = parseMapua(email);
      expect(result.status).toBe("parsed");
      expect(result.sourceKey).toBeNull();
    });

    it("malformed new_loc fails safely without throwing", () => {
      const email = assignmentEmail({
        TextBody: "Course: CS101\nTitle: BadNewLoc\nhttps://mapua.blackboard.com/webapps/login/?action=login&new_loc=%ZZ%FF",
      });
      const result = parseMapua(email);
      expect(result.status).toBe("parsed");
      expect(result.sourceKey).toBeNull();
    });

    it("conflicting strong item IDs fail closed with malformed status", () => {
      const email = assignmentEmail({
        TextBody: "Course: CS101\nTitle: TwoItems\nhttps://mapua.blackboard.com/item?content_id=_111_1\nhttps://mapua.blackboard.com/item?content_id=_222_1",
      });
      const result = parseMapua(email);
      expect(result.status).toBe("malformed");
      expect(result.reason).toBe("ambiguous_or_invalid_fields");
    });

    it("Safe Links tracking tokens (data, sdata, reserved) do not become identity", () => {
      const result = parseMapua(newContentEmail());
      expect(result.sourceUrl).not.toContain("sdata=");
      expect(result.sourceUrl).not.toContain("reserved=");
      expect(result.sourceKey).not.toContain("data");
    });
  });
});
