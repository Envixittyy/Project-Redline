/** Calendar is a projection over distinct persistence domains. */
export type CalendarSourceItem =
  | {
      kind: "task_deadline";
      id: string;
      taskId: string;
      dueAt: string;
    }
  | {
      kind: "task_work_session";
      id: string;
      taskId: string;
      startsAt: string;
      endsAt: string;
    }
  | {
      kind: "forward_native_event";
      id: string;
      startsAt: string;
      endsAt: string;
    }
  | {
      kind: "external_fixed_event";
      id: string;
      providerId: string;
      externalId: string;
      startsAt: string;
      endsAt: string;
      readOnly: boolean;
    }
  | {
      kind: "blackboard_event";
      id: string;
      externalUid: string;
      startsAt: string | null;
      endsAt: string | null;
      dueAt: string | null;
    };

export function isFixedCommitment(item: CalendarSourceItem): boolean {
  return item.kind === "forward_native_event"
    || item.kind === "external_fixed_event"
    || item.kind === "blackboard_event";
}

export function isTaskOwnedCalendarItem(item: CalendarSourceItem): boolean {
  return item.kind === "task_deadline" || item.kind === "task_work_session";
}
