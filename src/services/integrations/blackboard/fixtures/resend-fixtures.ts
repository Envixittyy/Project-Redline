/**
 * Synthetic Resend Received Email payloads for realistic end-to-end testing.
 * Conforms to Resend's Receiving API GET /emails/receiving/:id response shape.
 */

export function resendAssignmentEmail(overrides: Record<string, unknown> = {}) {
  return {
    object: "email",
    id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    from: "Blackboard <notifications@learn.example.edu>",
    to: ["school@inbound.example.com"],
    subject: "New assignment: Assignment 1",
    created_at: "2026-09-08T02:00:00.000Z",
    text: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: September 15, 2026 at 11:59 PM Asia/Manila\nWeight: 15%\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1",
    html: "",
    headers: {
      "message-id": "<msg-orig-123@learn.example.edu>",
      date: "Tue, 8 Sep 2026 10:00:00 +0800",
      "x-spam-status": "No",
      "x-spam-tests": "DKIM_VALID_AU",
      "authentication-results": "mx.resend.com; dkim=pass (good signature)",
    },
    message_id: "<msg-orig-123@learn.example.edu>",
    attachments: [],
    ...overrides,
  };
}

export function resendQuizEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-quiz-1",
    subject: "New quiz: Quiz 1 - Fundamentals",
    message_id: "<msg-quiz-101@learn.example.edu>",
    text: "Course: CS101\nItem Type: Quiz\nTitle: Quiz 1 - Fundamentals\nDue Date: September 20, 2026 at 11:59 PM Asia/Manila\nWeight: 10%\nhttps://learn.example.edu/webapps/assessment/take?course_id=_101_1&assessment_id=_301_1",
    ...overrides,
  });
}

export function resendExamEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-exam-1",
    subject: "Upcoming Exam: Midterm Exam",
    message_id: "<msg-exam-201@learn.example.edu>",
    text: "Course: CS101\nItem Type: Exam\nTitle: Midterm Exam\nDue Date: October 10, 2026 at 2:00 PM Asia/Manila\nWeight: 25%\nhttps://learn.example.edu/webapps/assessment/take?course_id=_101_1&assessment_id=_302_1",
    ...overrides,
  });
}

export function resendMaterialEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-mat-1",
    subject: "New content: Lecture Slides Week 2",
    message_id: "<msg-mat-401@learn.example.edu>",
    text: "Course: CS101\nItem Type: Material\nTitle: Lecture Slides Week 2\nhttps://learn.example.edu/webapps/blackboard/content?course_id=_101_1&content_id=_401_1",
    ...overrides,
  });
}

export function resendActionableMaterialEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-mat-act-1",
    subject: "Required reading: Chapter 3 Case Study",
    message_id: "<msg-mat-act-402@learn.example.edu>",
    text: "Course: CS101\nItem Type: Material\nTitle: Chapter 3 Case Study\nDue Date: September 24, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/webapps/blackboard/content?course_id=_101_1&content_id=_402_1",
    ...overrides,
  });
}

export function resendAnnouncementEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-ann-1",
    subject: "Announcement: Welcome to CS101",
    message_id: "<msg-ann-501@learn.example.edu>",
    text: "Course: CS101\nItem Type: Announcement\nTitle: Welcome to CS101\nPlease review the syllabus posted on the course site.\nhttps://learn.example.edu/webapps/blackboard/announcement?course_id=_101_1&announcement_id=_501_1",
    ...overrides,
  });
}

export function resendActionableAnnouncementEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-ann-act-1",
    subject: "Announcement: Submit Team Formation Form",
    message_id: "<msg-ann-act-502@learn.example.edu>",
    text: "Course: CS101\nItem Type: Announcement\nTitle: Submit Team Formation Form\nDue Date: September 26, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/webapps/blackboard/announcement?course_id=_101_1&announcement_id=_502_1",
    ...overrides,
  });
}

export function resendReminderEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-rem-1",
    subject: "Reminder: Assignment 1 due soon",
    message_id: "<msg-rem-601@learn.example.edu>",
    created_at: "2026-09-10T02:00:00.000Z",
    headers: {
      "message-id": "<msg-rem-601@learn.example.edu>",
      date: "Thu, 10 Sep 2026 10:00:00 +0800",
      "authentication-results": "mx.resend.com; dkim=pass",
    },
    ...overrides,
  });
}

export function resendDeadlineChangedEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-chg-1",
    subject: "Due date changed: Assignment 1",
    message_id: "<msg-chg-701@learn.example.edu>",
    created_at: "2026-09-11T02:00:00.000Z",
    text: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nNew Due Date: September 20, 2026 at 11:59 PM Asia/Manila\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1",
    headers: {
      "message-id": "<msg-chg-701@learn.example.edu>",
      date: "Fri, 11 Sep 2026 10:00:00 +0800",
      "authentication-results": "mx.resend.com; dkim=pass",
    },
    ...overrides,
  });
}

export function resendCourseOpenedEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-open-1",
    subject: "Course is now available: CS101",
    message_id: "<msg-open-801@learn.example.edu>",
    text: "Course: CS101\nTitle: Computer Science 1\nWelcome to your new course.",
    ...overrides,
  });
}

export function resendForwardedEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-fwd-1",
    from: "student@example.edu",
    subject: "FW: New assignment: Assignment 1",
    message_id: "<msg-fwd-901@example.edu>",
    text: `FYI
From: Blackboard <notifications@learn.example.edu>
Sent: Tue, 8 Sep 2026 10:00:00 +0800
Subject: New assignment: Assignment 1

Course: CS101
Item Type: Assignment
Title: Assignment 1
Due Date: September 15, 2026 at 11:59 PM Asia/Manila
https://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1`,
    headers: {
      "message-id": "<msg-fwd-901@example.edu>",
      date: "Tue, 8 Sep 2026 10:05:00 +0800",
      "authentication-results": "mx.resend.com; dkim=pass header.d=example.edu",
    },
    ...overrides,
  });
}

export function resendMultiRecipientEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-multi-rec-1",
    to: ["student@example.edu", "school@inbound.example.com"],
    received_for: ["school@inbound.example.com"],
    ...overrides,
  });
}

export function resendMultiHeaderDkimEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-multi-dkim-1",
    headers: {
      "message-id": "<msg-multi-dkim@learn.example.edu>",
      "authentication-results": [
        "outlook.com; spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=learn.example.edu; dkim=pass header.d=learn.example.edu",
        "mx.resend.com; dkim=pass (good signature) header.d=learn.example.edu",
      ],
    },
    ...overrides,
  });
}

export function resendUnknownNotificationEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-unk-1",
    subject: "Blackboard System Maintenance Notice",
    message_id: "<msg-unk-999@learn.example.edu>",
    text: "Course: CS101\nSystem will be offline on Sunday from 2 AM to 4 AM for scheduled maintenance.",
    ...overrides,
  });
}

export function resendMalformedEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-malf-1",
    subject: "New assignment: Bad Date",
    message_id: "<msg-malf-888@learn.example.edu>",
    text: "Course: CS101\nItem Type: Assignment\nTitle: Bad Date\nDue Date: whenever you can",
    ...overrides,
  });
}

export function resendUnmatchedCourseEmail(overrides: Record<string, unknown> = {}) {
  return resendAssignmentEmail({
    id: "resend-unmatched-1",
    subject: "New assignment: Unmatched Course Task",
    message_id: "<msg-unmatched-777@learn.example.edu>",
    text: "Course: UNKNOWN999_A1_1Q2627\nItem Type: Assignment\nTitle: Unmatched Course Task\nDue Date: 2026-10-15",
    ...overrides,
  });
}
