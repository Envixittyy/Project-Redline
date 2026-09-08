/** Synthetic Postmark payloads: no real mailbox or student content. */
export function assignmentEmail(overrides: Record<string, unknown> = {}) {
  return {
    MessageID: "delivery-assignment-1",
    FromFull: { Email: "notifications@learn.example.edu", Name: "Blackboard" },
    OriginalRecipient: "school@inbound.example.com",
    Subject: "New assignment: Assignment 1",
    Date: "Tue, 8 Sep 2026 10:00:00 +0800",
    TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Assignment 1\nDue Date: September 15, 2026 at 11:59 PM Asia/Manila\nWeight: 15%\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_201_1&utm_source=email",
    HtmlBody: "",
    Headers: [
      { Name: "X-Spam-Status", Value: "No" },
      { Name: "X-Spam-Tests", Value: "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU" },
    ],
    ...overrides,
  };
}
export const emailPolicy = { senders: ["notifications@learn.example.edu"], forwarders: ["student@example.edu"], hosts: ["learn.example.edu"], timeZone: "Asia/Manila" };
export const reminderEmail = () => assignmentEmail({ MessageID: "reminder-1", Subject: "Assignment reminder", Date: "Wed, 9 Sep 2026 10:00:00 +0800" });
export const deadlineEmail = () => assignmentEmail({ MessageID: "deadline-1", Subject: "Assignment due date changed", Date: "Thu, 10 Sep 2026 10:00:00 +0800", TextBody: assignmentEmail().TextBody.replace("September 15", "September 18") });
export const forwardedEmail = () => assignmentEmail({ MessageID: "forward-1", FromFull: { Email: "student@example.edu" }, Subject: "FW: New assignment: Assignment 1", TextBody: `Please add this.\nFrom: Blackboard <notifications@learn.example.edu>\nSent: Tue, 8 Sep 2026 10:00:00 +0800\nSubject: New assignment: Assignment 1\n\n${assignmentEmail().TextBody}` });

export const quizEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "quiz-delivery-1",
  Subject: "New quiz: Quiz 2 - Data Structures",
  Date: "Wed, 9 Sep 2026 14:00:00 +0800",
  TextBody: "Course: CS101\nItem Type: Quiz\nTitle: Quiz 2 - Data Structures\nDue Date: September 22, 2026 at 11:59 PM Asia/Manila\nWeight: 10%\nhttps://learn.example.edu/webapps/assessment/take?course_id=_101_1&assessment_id=_401_1",
  ...overrides,
});

export const examEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "exam-delivery-1",
  Subject: "Upcoming Exam: Midterm Examination",
  Date: "Wed, 9 Sep 2026 15:00:00 +0800",
  TextBody: "Course: CS101\nItem Type: Exam\nTitle: Midterm Examination\nDue Date: October 5, 2026 at 2:00 PM Asia/Manila\nWeight: 30%\nhttps://learn.example.edu/webapps/assessment/take?course_id=_101_1&assessment_id=_501_1",
  ...overrides,
});

export const materialEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "material-delivery-1",
  Subject: "New course material available: Week 3 Slides",
  Date: "Thu, 10 Sep 2026 09:00:00 +0800",
  TextBody: "Course: CS101\nItem Type: Material\nTitle: Week 3 Slides - Memory Management\nhttps://learn.example.edu/webapps/blackboard/content/content.jsp?course_id=_101_1&content_id=_601_1",
  ...overrides,
});

export const announcementEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "announcement-delivery-1",
  Subject: "Announcement: Review Session Scheduled",
  Date: "Thu, 10 Sep 2026 11:00:00 +0800",
  TextBody: "Course: CS101\nItem Type: Announcement\nTitle: Review Session Scheduled\nPlease join us for the midterm review session this Friday at 3 PM.\nhttps://learn.example.edu/webapps/blackboard/announcement?course_id=_101_1&announcement_id=_701_1",
  ...overrides,
});

export const missingDueDateEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "undated-delivery-1",
  Subject: "New practice assignment: Self-Paced Exercises",
  Date: "Fri, 11 Sep 2026 08:00:00 +0800",
  TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Self-Paced Exercises\nhttps://learn.example.edu/webapps/assignment/uploadAssignment?course_id=_101_1&content_id=_801_1",
  ...overrides,
});

export const missingUrlEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "nourl-delivery-1",
  Subject: "New assignment: Reading Reflection",
  Date: "Fri, 11 Sep 2026 09:00:00 +0800",
  TextBody: "Course: CS101\nItem Type: Assignment\nTitle: Reading Reflection\nDue Date: September 25, 2026",
  ...overrides,
});

export const unrelatedSchoolEmail = (overrides: Record<string, unknown> = {}) => ({
  MessageID: "unrelated-faculty-1",
  FromFull: { Email: "professor.johnson@example.edu", Name: "Prof. Johnson" },
  OriginalRecipient: "school@inbound.example.com",
  Subject: "Office Hours Reminder - Check Blackboard for Link",
  Date: "Mon, 7 Sep 2026 08:30:00 +0800",
  TextBody: "Hi students, remember to check Blackboard for my updated office hours link.\nBest,\nProf. Johnson",
  HtmlBody: "",
  Headers: [
    { Name: "X-Spam-Status", Value: "No" },
    { Name: "X-Spam-Tests", Value: "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU" },
  ],
  ...overrides,
});

export const spoofedBlackboardEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "spoofed-delivery-1",
  Headers: [
    { Name: "X-Spam-Status", Value: "Yes" },
    { Name: "X-Spam-Tests", Value: "SPF_FAIL,DKIM_INVALID" },
  ],
  ...overrides,
});
