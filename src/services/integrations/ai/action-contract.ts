export const aiActionTypes = [
  "list_tasks",
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "reschedule_task",
  "list_events",
  "create_event",
  "create_note",
  "search_notes",
  "get_free_time",
  "schedule_task",
  "propose_plan",
  "send_to_notion",
  "propose_course",
  "associate_course_material",
] as const;

export type AiActionType = (typeof aiActionTypes)[number];

type ProposedActionBase = {
  confidence: number;
  rationale?: string;
};

export type ProposedAiAction = ProposedActionBase & (
  | { type: "list_tasks"; query?: string }
  | { type: "create_task"; title: string; due_at?: string; priority?: string; course_id?: string }
  | { type: "update_task"; task_id: string; title?: string; due_at?: string | null; priority?: string; course_id?: string | null }
  | { type: "complete_task"; task_id: string }
  | { type: "delete_task"; task_id: string }
  | { type: "reschedule_task"; task_id: string; starts_at: string; ends_at: string }
  | { type: "list_events"; starts_at: string; ends_at: string }
  | { type: "create_event"; title: string; starts_at: string; ends_at: string }
  | { type: "create_note"; title: string; body?: string; task_id?: string | null; course_id?: string | null }
  | { type: "search_notes"; query: string }
  | { type: "get_free_time"; starts_at: string; ends_at: string; duration_minutes: number }
  | { type: "schedule_task"; task_id: string; starts_at: string; ends_at: string }
  | { type: "propose_plan"; task_ids: readonly string[]; starts_at: string; ends_at: string }
  | { type: "send_to_notion"; entity_type: "note"; entity_id: string }
  | { type: "propose_course"; code: string; name: string; instructor?: string; location?: string; color?: string }
  | { type: "associate_course_material"; task_id: string; course_id: string; material_title: string }
);

export type AiActionProposal = {
  schema_version: 1;
  actions: readonly ProposedAiAction[];
};

export type AiActionParseResult =
  | { ok: true; value: AiActionProposal }
  | { ok: false; issues: readonly string[] };

const mutationTypes = new Set<AiActionType>([
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "reschedule_task",
  "create_event",
  "create_note",
  "schedule_task",
  "send_to_notion",
  "propose_course",
  "associate_course_material",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, issues: string[]): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${key} must be a non-empty string.`);
    return "";
  }
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${key} must be a non-empty string when provided.`);
    return undefined;
  }
  return value.trim();
}

function instant(record: Record<string, unknown>, key: string, issues: string[]): string {
  const value = requiredString(record, key, issues);
  if (value && (Number.isNaN(Date.parse(value)) || !/[zZ]|[+-]\d\d:\d\d$/.test(value))) {
    issues.push(`${key} must be an ISO instant with an offset.`);
  }
  return value;
}

function optionalInstant(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): string | undefined {
  const value = optionalString(record, key, issues);
  if (value && (Number.isNaN(Date.parse(value)) || !/[zZ]|[+-]\d\d:\d\d$/.test(value))) {
    issues.push(`${key} must be an ISO instant with an offset.`);
  }
  return value;
}

function parseAction(value: unknown, index: number, issues: string[]): ProposedAiAction | null {
  if (!isRecord(value)) {
    issues.push(`actions[${index}] must be an object.`);
    return null;
  }

  const type = value.type;
  if (typeof type !== "string" || !aiActionTypes.includes(type as AiActionType)) {
    issues.push(`actions[${index}].type is not an allowed application action.`);
    return null;
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    issues.push(`actions[${index}].confidence must be between 0 and 1.`);
  }

  const actionIssues: string[] = [];
  const confidence = typeof value.confidence === "number" ? value.confidence : 0;
  const rationale = optionalString(value, "rationale", actionIssues);
  const base = rationale === undefined ? { confidence } : { confidence, rationale };
  let action: ProposedAiAction;

  switch (type as AiActionType) {
    case "list_tasks":
      action = { ...base, type: "list_tasks", query: optionalString(value, "query", actionIssues) };
      break;
    case "create_task":
      action = {
        ...base,
        type: "create_task",
        title: requiredString(value, "title", actionIssues),
        due_at: optionalInstant(value, "due_at", actionIssues),
        priority: optionalString(value, "priority", actionIssues),
        course_id: optionalString(value, "course_id", actionIssues),
      };
      break;
    case "update_task": {
      const rawDueAt = value.due_at;
      const dueAt = rawDueAt === null ? null : optionalInstant(value, "due_at", actionIssues);
      const title = optionalString(value, "title", actionIssues);
      const priority = optionalString(value, "priority", actionIssues);
      const courseId = value.course_id === null ? null : optionalString(value, "course_id", actionIssues);
      action = {
        ...base,
        type: "update_task",
        task_id: requiredString(value, "task_id", actionIssues),
        title,
        due_at: dueAt,
        priority,
        course_id: courseId,
      };
      if (title === undefined && dueAt === undefined && priority === undefined && courseId === undefined) {
        actionIssues.push("update_task must include at least one mutable field.");
      }
      break;
    }
    case "complete_task":
      action = {
        ...base,
        type: "complete_task",
        task_id: requiredString(value, "task_id", actionIssues),
      };
      break;
    case "delete_task":
      action = {
        ...base,
        type: "delete_task",
        task_id: requiredString(value, "task_id", actionIssues),
      };
      break;
    case "reschedule_task":
      action = {
        ...base,
        type: "reschedule_task",
        task_id: requiredString(value, "task_id", actionIssues),
        starts_at: instant(value, "starts_at", actionIssues),
        ends_at: instant(value, "ends_at", actionIssues),
      };
      break;
    case "list_events":
      action = {
        ...base,
        type: "list_events",
        starts_at: instant(value, "starts_at", actionIssues),
        ends_at: instant(value, "ends_at", actionIssues),
      };
      break;
    case "create_event":
      action = {
        ...base,
        type: "create_event",
        title: requiredString(value, "title", actionIssues),
        starts_at: instant(value, "starts_at", actionIssues),
        ends_at: instant(value, "ends_at", actionIssues),
      };
      break;
    case "create_note":
      action = {
        ...base,
        type: "create_note",
        title: requiredString(value, "title", actionIssues),
        body: optionalString(value, "body", actionIssues),
        task_id: optionalString(value, "task_id", actionIssues),
        course_id: optionalString(value, "course_id", actionIssues),
      };
      break;
    case "search_notes":
      action = {
        ...base,
        type: "search_notes",
        query: requiredString(value, "query", actionIssues),
      };
      break;
    case "get_free_time": {
      const durationMinutes = typeof value.duration_minutes === "number"
        ? value.duration_minutes
        : 0;
      action = {
        ...base,
        type: "get_free_time",
        starts_at: instant(value, "starts_at", actionIssues),
        ends_at: instant(value, "ends_at", actionIssues),
        duration_minutes: durationMinutes,
      };
      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
        actionIssues.push("duration_minutes must be a positive integer.");
      }
      break;
    }
    case "schedule_task":
      action = {
        ...base,
        type: "schedule_task",
        task_id: requiredString(value, "task_id", actionIssues),
        starts_at: instant(value, "starts_at", actionIssues),
        ends_at: instant(value, "ends_at", actionIssues),
      };
      break;
    case "propose_plan": {
      const taskIds = Array.isArray(value.task_ids)
        ? value.task_ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        : [];
      action = {
        ...base,
        type: "propose_plan",
        task_ids: taskIds,
        starts_at: instant(value, "starts_at", actionIssues),
        ends_at: instant(value, "ends_at", actionIssues),
      };
      if (taskIds.length === 0) actionIssues.push("task_ids must contain at least one ID.");
      break;
    }
    case "send_to_notion":
      action = {
        ...base,
        type: "send_to_notion",
        entity_type: "note",
        entity_id: requiredString(value, "entity_id", actionIssues),
      };
      if (value.entity_type !== "note") actionIssues.push("entity_type must be note.");
      break;
    case "propose_course":
      action = {
        ...base,
        type: "propose_course",
        code: requiredString(value, "code", actionIssues),
        name: requiredString(value, "name", actionIssues),
        instructor: optionalString(value, "instructor", actionIssues),
        location: optionalString(value, "location", actionIssues),
        color: optionalString(value, "color", actionIssues),
      };
      break;
    case "associate_course_material":
      action = {
        ...base,
        type: "associate_course_material",
        task_id: requiredString(value, "task_id", actionIssues),
        course_id: requiredString(value, "course_id", actionIssues),
        material_title: requiredString(value, "material_title", actionIssues),
      };
      break;
  }

  const startsAt = "starts_at" in action && action.starts_at ? Date.parse(action.starts_at) : null;
  const endsAt = "ends_at" in action && action.ends_at ? Date.parse(action.ends_at) : null;
  if (startsAt !== null && endsAt !== null && startsAt >= endsAt) {
    actionIssues.push("ends_at must be after starts_at.");
  }

  issues.push(...actionIssues.map((issue) => `actions[${index}].${issue}`));
  return actionIssues.length === 0 ? action : null;
}

/** Parse untrusted model JSON into narrow application actions. */
export function parseAiActionProposal(input: unknown): AiActionParseResult {
  if (!isRecord(input)) return { ok: false, issues: ["Proposal must be an object."] };
  const issues: string[] = [];
  if (input.schema_version !== 1) issues.push("schema_version must be 1.");
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    issues.push("actions must be a non-empty array.");
  }
  const actions = Array.isArray(input.actions)
    ? input.actions.map((action, index) => parseAction(action, index, issues)).filter(Boolean)
    : [];

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { schema_version: 1, actions: actions as ProposedAiAction[] } };
}

export function isMutatingAiAction(action: ProposedAiAction): boolean {
  return mutationTypes.has(action.type);
}
