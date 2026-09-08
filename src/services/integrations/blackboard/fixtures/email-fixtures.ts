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
