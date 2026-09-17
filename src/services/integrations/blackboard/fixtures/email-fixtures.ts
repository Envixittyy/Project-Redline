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

export const mapuaPolicy = {
  senders: ["notifications@learn.example.edu", "donotreply@mapua.blackboard.com"],
  forwarders: ["student@example.edu"],
  hosts: ["learn.example.edu", "mapua.blackboard.com"],
  timeZone: "Asia/Manila",
};

export const submissionReceivedEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "mapua-submission-1",
  FromFull: { Email: "notifications@learn.example.edu", Name: "Blackboard" },
  Subject: "Submission received",
  Date: "Thu, 17 Sep 2026 19:00:00 +0800",
  TextBody: `GED107_C2_1Q2627
ETHICS
Assessment submitted
Synthesis Quiz 2 (10%)
Submitted:
Thursday, September 17, 2026 6:56:05 PM PST
Confirmation number:
54d298eb0e594da3b418696f89b7e0d4
View Submission <https://mapua.blackboard.com/webapps/login/?action=login&new_loc=%2Fultra%2Fredirect%3FredirectType%3Dnautilus%26userId%3D_142032_1%26courseId%3D_165894_1%26contentId%3D_6827441_1%26sourceId%3D_36206079_1%257Cblackboard.platform.gradebook2.AttemptDetail%26parentId%3Dnull%26sourceType%3DTE%26eventType%3DTE_ATTEMPT%26disable_promiscuous_decodes%3Dtrue>
Email brought to you by:
[Blackboard Inc.]`,
  ...overrides,
});

export const newContentEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "mapua-content-1",
  FromFull: { Email: "notifications@learn.example.edu", Name: "Blackboard" },
  Subject: "New content",
  Date: "Thu, 17 Sep 2026 10:00:00 +0800",
  TextBody: `RZL110_A4_1Q2627
ANG BUHAY AT MGA AKDA NI RIZAL (TTHS/ONLINE/ 9:00 AM - 10:30 AM)

New content

Ikapitong Linggo - Si Rizal at Ang Noli Me Tangere.pdf

https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fmapua.blackboard.com%2Fwebapps%2Flogin%2F%3Faction%3Dlogin%26new_loc%3D%252Fultra%252Fredirect%253FredirectType%253Dnautilus%2526userId%253D_142032_1%2526courseId%253D_165958_1%2526contentId%253D_7043773_1%2526sourceId%253D_7043773_1%25257Cblackboard.data.content.Content%2526parentId%253Dnull%2526sourceType%253DCO%2526eventType%253DCO_AVAIL%2526disable_promiscuous_decodes%253Dtrue&data=05%7C02%7Ctest&sdata=xyz&reserved=0`,
  ...overrides,
});

export const newGradeAndFeedbackEmail = (overrides: Record<string, unknown> = {}) => assignmentEmail({
  MessageID: "mapua-grade-1",
  FromFull: { Email: "notifications@learn.example.edu", Name: "Blackboard" },
  Subject: "New grade and feedback",
  Date: "Thu, 17 Sep 2026 11:00:00 +0800",
  TextBody: `MATH177_E06_1Q2627
03 CALCULUS 2 [MWF 4:30 PM]

New grade and feedback

Calculus through Data & Modelling: Series and Integration
Assessment

https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fmapua.blackboard.com%2Fwebapps%2Flogin%2F%3Faction%3Dlogin%26new_loc%3D%252Fultra%252Fredirect%253FredirectType%253Dnautilus%2526userId%253D_142032_1%2526courseId%253D_164519_1%2526contentId%253D_6996549_1%2526sourceId%253D_43426431_1%25257Cblackboard.platform.gradebook2.GradeDetail%2526parentId%253Dnull%2526sourceType%253DGB%2526eventType%253DGB_ATT_UPDATED%2526disable_promiscuous_decodes%253Dtrue&data=05%7C02%7Ctest&sdata=xyz&reserved=0`,
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
