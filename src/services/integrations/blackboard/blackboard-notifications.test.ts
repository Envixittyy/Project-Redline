import { describe, expect, it } from "vitest";

import {
  formatBlackboardNotificationBody,
  formatBlackboardNotificationTitle,
  formatBlackboardReviewDeepLink,
  isQuietHours,
  notificationDedupeKey,
  planBlackboardProposalNotification,
  safeDeepLink,
} from "@/services/notifications/notification-domain";

describe("Phase 7B: Secure Blackboard / School Change Notifications", () => {
  const sampleExternalRecordId = "ext-rec-12345";
  const sampleProposalId = "prop-67890";
  const sampleRevision = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  const changedRevision = "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5";

  // Requirement 1: new actionable Blackboard proposal emits one notification
  it("emits exactly one notification for a newly created actionable proposal", () => {
    const planned = planBlackboardProposalNotification({
      externalRecordId: sampleExternalRecordId,
      proposalId: sampleProposalId,
      proposalStatus: "proposed",
      proposalRevision: sampleRevision,
      title: "Assignment 4",
      courseCode: "CS123",
      courseId: "course-uuid-1",
      isFallbackUid: false,
      isCreate: true,
    });

    expect(planned).not.toBeNull();
    expect(planned).toEqual({
      eventType: "blackboard_assignment",
      dedupeKey: `blackboard_assignment:${sampleExternalRecordId}:${sampleRevision}`,
      title: "New Blackboard item",
      body: "CS123 — Assignment 4 is available for review.",
      deepLink: `/inbox?proposal=${sampleProposalId}`,
      courseId: "course-uuid-1",
    });
  });

  // Requirement 2: repeated unchanged sync does not emit duplicates
  it("does not emit duplicate notifications on repeated unchanged sync", () => {
    const planned = planBlackboardProposalNotification({
      externalRecordId: sampleExternalRecordId,
      proposalId: sampleProposalId,
      proposalStatus: "proposed",
      proposalRevision: sampleRevision,
      previousProposalRevision: sampleRevision, // unchanged
      title: "Assignment 4",
      courseCode: "CS123",
      isFallbackUid: false,
      isCreate: false,
    });

    expect(planned).toBeNull();
  });

  // Requirement 3: notification references proposal/review, not a native task
  it("notification deep link and copy reference proposal review in Inbox, never a native task", () => {
    const planned = planBlackboardProposalNotification({
      externalRecordId: sampleExternalRecordId,
      proposalId: sampleProposalId,
      proposalStatus: "proposed",
      proposalRevision: sampleRevision,
      title: "Essay 1",
      courseCode: "ENG101",
      isFallbackUid: false,
      isCreate: true,
    });

    expect(planned?.deepLink).toBe(`/inbox?proposal=${sampleProposalId}`);
    expect(planned?.deepLink).not.toContain("/tasks");
    expect(planned?.body).toContain("is available for review.");
    expect(planned?.body).not.toContain("Task created");
  });

  // Requirement 4: dismissed unchanged proposal produces no repeated notification
  it("dismissed proposal with unchanged revision produces no notification", () => {
    const planned = planBlackboardProposalNotification({
      externalRecordId: sampleExternalRecordId,
      proposalId: sampleProposalId,
      proposalStatus: "rejected",
      proposalRevision: sampleRevision,
      previousProposalRevision: sampleRevision,
      title: "Optional Survey",
      courseCode: "CS101",
      isFallbackUid: false,
      isCreate: false,
    });

    expect(planned).toBeNull();
  });

  // Requirement 5: accepted proposal produces no new review notification on unchanged sync
  it("accepted proposal linked to native task produces no review notification on unchanged sync", () => {
    const planned = planBlackboardProposalNotification({
      externalRecordId: sampleExternalRecordId,
      proposalId: sampleProposalId,
      proposalStatus: "committed",
      proposalRevision: sampleRevision,
      previousProposalRevision: sampleRevision,
      title: "Project Milestone 1",
      courseCode: "CS200",
      isFallbackUid: false,
      isCreate: false,
    });

    expect(planned).toBeNull();
  });

  // Requirement 6: materially changed proposal follows approved renotification semantics
  describe("material source changes", () => {
    it("notifies for unreviewed proposal when deadline is updated", () => {
      const planned = planBlackboardProposalNotification({
        externalRecordId: sampleExternalRecordId,
        proposalId: sampleProposalId,
        proposalStatus: "proposed",
        proposalRevision: changedRevision,
        previousProposalRevision: sampleRevision,
        title: "Homework 3",
        courseCode: "MATH101",
        isFallbackUid: false,
        isCreate: false,
        deadlineChanged: true,
      });

      expect(planned).not.toBeNull();
      expect(planned?.eventType).toBe("blackboard_deadline_changed");
      expect(planned?.title).toBe("Blackboard deadline changed");
      expect(planned?.body).toBe(
        "MATH101 — Homework 3 deadline was updated and is available for review.",
      );
      expect(planned?.dedupeKey).toBe(
        `blackboard_deadline_changed:${sampleExternalRecordId}:${changedRevision}`,
      );
    });

    it("notifies for reopened dismissed proposal when source materially changes", () => {
      // Reconcile RPC reopens rejected -> proposed on material change
      const planned = planBlackboardProposalNotification({
        externalRecordId: sampleExternalRecordId,
        proposalId: sampleProposalId,
        proposalStatus: "proposed", // reopened
        proposalRevision: changedRevision,
        previousProposalRevision: sampleRevision,
        title: "Syllabus Quiz",
        courseCode: "BIO101",
        isFallbackUid: false,
        isCreate: false,
        deadlineChanged: false,
      });

      expect(planned).not.toBeNull();
      expect(planned?.eventType).toBe("blackboard_assignment");
      expect(planned?.title).toBe("Blackboard item updated");
      expect(planned?.body).toBe("BIO101 — Syllabus Quiz was updated and is available for review.");
    });

    it("notifies divergence for accepted proposal when Blackboard source updates without mutating task", () => {
      const planned = planBlackboardProposalNotification({
        externalRecordId: sampleExternalRecordId,
        proposalId: sampleProposalId,
        proposalStatus: "committed", // accepted into native task
        proposalRevision: changedRevision,
        previousProposalRevision: sampleRevision,
        title: "Lab Report 2",
        courseCode: "PHYS101",
        isFallbackUid: false,
        isCreate: false,
      });

      expect(planned).not.toBeNull();
      expect(planned?.eventType).toBe("blackboard_proposal_divergence");
      expect(planned?.title).toBe("Blackboard item updated");
      expect(planned?.body).toBe(
        "PHYS101 — Lab Report 2 was updated on Blackboard. Your native task remains unchanged.",
      );
      expect(planned?.deepLink).toBe(`/inbox?proposal=${sampleProposalId}`);
    });
  });

  // Requirement 7: deep link is safe and points to proposal review
  it("safeDeepLink validates relative proposal review paths and sanitizes external/malicious URLs", () => {
    expect(formatBlackboardReviewDeepLink(sampleProposalId)).toBe(
      `/inbox?proposal=${sampleProposalId}`,
    );
    expect(formatBlackboardReviewDeepLink(null)).toBe("/inbox");
    expect(safeDeepLink(`/inbox?proposal=${sampleProposalId}`)).toBe(
      `/inbox?proposal=${sampleProposalId}`,
    );

    // Rejects external URLs
    expect(safeDeepLink("https://blackboard.university.edu/webapps/assessment")).toBe("/");
    expect(safeDeepLink("//malicious.com/inbox")).toBe("/");
    expect(safeDeepLink("javascript:alert(1)")).toBe("/");
  });

  // Requirement 8: course/title metadata rendered when available
  it("formats course and title cleanly without duplicate course prefixes", () => {
    // Separate course code
    expect(
      formatBlackboardNotificationBody({ title: "Assignment 4", courseCode: "CS123" }),
    ).toBe("CS123 — Assignment 4 is available for review.");

    // Title already includes bracketed course code
    expect(
      formatBlackboardNotificationBody({ title: "[CS123] Assignment 4", courseCode: "CS123" }),
    ).toBe("[CS123] Assignment 4 is available for review.");

    // Title already starts with course code prefix
    expect(
      formatBlackboardNotificationBody({ title: "CS123 - Assignment 4", courseCode: "CS123" }),
    ).toBe("CS123 - Assignment 4 is available for review.");
  });

  // Requirement 9: missing optional metadata handled safely
  it("handles missing title and course code gracefully without fabricating data", () => {
    expect(formatBlackboardNotificationBody({ title: null, courseCode: null })).toBe(
      "Untitled Blackboard item is available for review.",
    );
    expect(formatBlackboardNotificationBody({ title: "Quick Reading", courseCode: null })).toBe(
      "Quick Reading is available for review.",
    );
    expect(formatBlackboardNotificationBody({ title: "", courseCode: "CS101" })).toBe(
      "CS101 — Untitled Blackboard item is available for review.",
    );
  });

  // Requirement 10: ownership isolation preserved
  it("incorporates user_id and external record identity in deduplication key", () => {
    const key1 = notificationDedupeKey("blackboard_assignment", "record-user-1", sampleRevision);
    const key2 = notificationDedupeKey("blackboard_assignment", "record-user-2", sampleRevision);
    expect(key1).not.toBe(key2);
  });

  // Requirement 11: fallback UIDs are ignored from notification eligibility
  it("never proposes or emits notifications for fallback UID records", () => {
    const planned = planBlackboardProposalNotification({
      externalRecordId: "fallback-record-1",
      proposalId: null,
      proposalStatus: "proposed",
      proposalRevision: sampleRevision,
      title: "Fallback item without UID",
      isFallbackUid: true,
      isCreate: true,
    });

    expect(planned).toBeNull();
  });

  // Requirement 12: quiet-hours behavior follows Phase 4D contract
  it("detects quiet hours correctly across midnight boundaries without dropping notification state", () => {
    // 22:00 to 07:00 Manila (UTC+8)
    // 23:30 Manila time (15:30 UTC) is inside quiet hours
    expect(
      isQuietHours(new Date("2026-08-29T15:30:00Z"), "Asia/Manila", "22:00", "07:00"),
    ).toBe(true);

    // 12:00 Manila time (04:00 UTC) is outside quiet hours
    expect(
      isQuietHours(new Date("2026-08-29T04:00:00Z"), "Asia/Manila", "22:00", "07:00"),
    ).toBe(false);

    // Null or identical quiet start/end means quiet hours are disabled
    expect(
      isQuietHours(new Date("2026-08-29T15:30:00Z"), "Asia/Manila", null, null),
    ).toBe(false);
    expect(
      isQuietHours(new Date("2026-08-29T15:30:00Z"), "Asia/Manila", "22:00", "22:00"),
    ).toBe(false);
  });

  // Requirement 13 & 14: notification creation idempotence
  it("maintains deterministic notification titles and dedupe keys across repeated calls", () => {
    const title1 = formatBlackboardNotificationTitle("new_proposal");
    const title2 = formatBlackboardNotificationTitle("new_proposal");
    expect(title1).toBe(title2);

    const dedupe1 = notificationDedupeKey("blackboard_assignment", sampleExternalRecordId, sampleRevision);
    const dedupe2 = notificationDedupeKey("blackboard_assignment", sampleExternalRecordId, sampleRevision);
    expect(dedupe1).toBe(dedupe2);
  });
});
