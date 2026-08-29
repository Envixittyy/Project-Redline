export type NotificationType =
  | "blackboard_assignment"
  | "blackboard_deadline_changed"
  | "blackboard_proposal_divergence"
  | "due_reminder"
  | "sync_failure"
  | "daily_digest";

export type BlackboardNotificationKind =
  | "new_proposal"
  | "proposal_changed"
  | "deadline_changed"
  | "divergence";

export function notificationDedupeKey(
  type: NotificationType | string,
  sourceId: string,
  revision: string,
): string {
  return `${type}:${sourceId}:${revision}`;
}

export function safeDeepLink(value: string): string {
  return /^\/(?!\/)[A-Za-z0-9/_?=&%.-]*$/.test(value) ? value : "/";
}

export function isQuietHours(
  now: Date,
  timeZone: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return start < end
    ? parts >= start && parts < end
    : parts >= start || parts < end;
}

export function pushAvailability(input: {
  serviceWorker: boolean;
  pushManager: boolean;
  standalone: boolean;
  isIOS: boolean;
  vapidKey: boolean;
}) {
  if (!input.serviceWorker || !input.pushManager) {
    return { available: false, reason: "unsupported" as const };
  }
  if (input.isIOS && !input.standalone) {
    return { available: false, reason: "install_required" as const };
  }
  if (!input.vapidKey) {
    return { available: false, reason: "server_unconfigured" as const };
  }
  return { available: true, reason: null };
}

export function safeNotificationPayload(input: {
  title: string;
  body: string;
  deepLink: string;
  dedupeKey: string;
}) {
  return {
    title: input.title.slice(0, 100),
    body: input.body.replace(/https?:\/\/\S+/gi, "[link removed]").slice(0, 240),
    url: safeDeepLink(input.deepLink),
    dedupeKey: input.dedupeKey,
  };
}

export function formatBlackboardNotificationTitle(
  kind: BlackboardNotificationKind = "new_proposal",
): string {
  switch (kind) {
    case "deadline_changed":
      return "Blackboard deadline changed";
    case "proposal_changed":
    case "divergence":
      return "Blackboard item updated";
    case "new_proposal":
    default:
      return "New Blackboard item";
  }
}

export function formatBlackboardNotificationBody(
  item: { title?: string | null; courseCode?: string | null },
  kind: BlackboardNotificationKind = "new_proposal",
): string {
  const rawTitle = item.title?.trim() || "Untitled Blackboard item";
  const course = item.courseCode?.trim();

  let itemLabel = rawTitle;
  if (course) {
    const courseUpper = course.toUpperCase();
    const rawUpper = rawTitle.toUpperCase();
    const alreadyPrefixed =
      rawUpper.startsWith(`[${courseUpper}]`) ||
      rawUpper.startsWith(`${courseUpper} —`) ||
      rawUpper.startsWith(`${courseUpper} -`) ||
      rawUpper.startsWith(`${courseUpper}:`);

    if (!alreadyPrefixed) {
      itemLabel = `${course} — ${rawTitle}`;
    }
  }

  switch (kind) {
    case "deadline_changed":
      return `${itemLabel} deadline was updated and is available for review.`;
    case "proposal_changed":
      return `${itemLabel} was updated and is available for review.`;
    case "divergence":
      return `${itemLabel} was updated on Blackboard. Your native task remains unchanged.`;
    case "new_proposal":
    default:
      return `${itemLabel} is available for review.`;
  }
}

export function formatBlackboardReviewDeepLink(proposalId?: string | null): string {
  if (!proposalId) return "/inbox";
  return safeDeepLink(`/inbox?proposal=${encodeURIComponent(proposalId)}`);
}

export type PlannedBlackboardNotification = {
  eventType: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string;
  courseId: string | null;
};

export function planBlackboardProposalNotification(input: {
  externalRecordId: string;
  proposalId: string | null;
  proposalStatus: "proposed" | "rejected" | "committed" | string;
  proposalRevision: string;
  previousProposalRevision?: string | null;
  title: string;
  courseCode?: string | null;
  courseId?: string | null;
  isFallbackUid?: boolean;
  isCreate?: boolean;
  deadlineChanged?: boolean;
}): PlannedBlackboardNotification | null {
  if (input.isFallbackUid) {
    return null;
  }

  const deepLink = formatBlackboardReviewDeepLink(input.proposalId);

  // 1. Newly created proposal
  if (input.isCreate) {
    if (input.proposalStatus !== "proposed") return null;
    return {
      eventType: "blackboard_assignment",
      dedupeKey: notificationDedupeKey(
        "blackboard_assignment",
        input.externalRecordId,
        input.proposalRevision,
      ),
      title: formatBlackboardNotificationTitle("new_proposal"),
      body: formatBlackboardNotificationBody(
        { title: input.title, courseCode: input.courseCode },
        "new_proposal",
      ),
      deepLink,
      courseId: input.courseId ?? null,
    };
  }

  // 2. Updated record: only notify if semantic revision materially changed
  if (
    input.previousProposalRevision &&
    input.previousProposalRevision === input.proposalRevision
  ) {
    return null;
  }

  if (input.proposalStatus === "proposed") {
    const kind: BlackboardNotificationKind = input.deadlineChanged
      ? "deadline_changed"
      : "proposal_changed";
    const eventType: NotificationType = input.deadlineChanged
      ? "blackboard_deadline_changed"
      : "blackboard_assignment";

    return {
      eventType,
      dedupeKey: notificationDedupeKey(
        eventType,
        input.externalRecordId,
        input.proposalRevision,
      ),
      title: formatBlackboardNotificationTitle(kind),
      body: formatBlackboardNotificationBody(
        { title: input.title, courseCode: input.courseCode },
        kind,
      ),
      deepLink,
      courseId: input.courseId ?? null,
    };
  }

  if (input.proposalStatus === "committed") {
    // Source divergence: native task remains untouched
    return {
      eventType: "blackboard_proposal_divergence",
      dedupeKey: notificationDedupeKey(
        "blackboard_proposal_divergence",
        input.externalRecordId,
        input.proposalRevision,
      ),
      title: formatBlackboardNotificationTitle("divergence"),
      body: formatBlackboardNotificationBody(
        { title: input.title, courseCode: input.courseCode },
        "divergence",
      ),
      deepLink,
      courseId: input.courseId ?? null,
    };
  }

  // Dismissed proposal that was not reopened, or unrecognized status: do not notify
  return null;
}

