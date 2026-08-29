import { isMutatingAiAction, type ProposedAiAction } from "../action-contract";

export const REDLINE_CAPABILITIES = [
  // Read capabilities
  "tasks.read",
  "calendar.read",
  "courses.read",
  "school.read",
  "notes.read",
  "courseMaterials.read",
  // Proposal capabilities
  "tasks.proposeCreate",
  "tasks.proposeUpdate",
  "tasks.proposeComplete",
  "tasks.proposeReschedule",
  "tasks.proposeDelete",
  "calendar.proposeCreate",
  "calendar.proposeUpdate",
  "notes.proposeCreate",
  "notes.proposeUpdate",
  "courses.proposeCreate",
  "courses.proposeUpdate",
  "courseMaterials.proposeAssociate",
] as const;

export type RedlineCapabilityId = (typeof REDLINE_CAPABILITIES)[number];

export type CapabilityDescriptor = {
  id: RedlineCapabilityId;
  name: string;
  category: "tasks" | "calendar" | "courses" | "school" | "notes" | "courseMaterials";
  access: "read" | "proposal";
  description: string;
};

export const CAPABILITY_CATALOG: readonly CapabilityDescriptor[] = [
  {
    id: "tasks.read",
    name: "Read Tasks",
    category: "tasks",
    access: "read",
    description: "Read open tasks and task details for the user.",
  },
  {
    id: "calendar.read",
    name: "Read Calendar",
    category: "calendar",
    access: "read",
    description: "Read events and scheduled work sessions in a date range.",
  },
  {
    id: "courses.read",
    name: "Read Courses",
    category: "courses",
    access: "read",
    description: "Read registered courses, codes, and instructor information.",
  },
  {
    id: "school.read",
    name: "Read School Schedule",
    category: "school",
    access: "read",
    description: "Read recurring class meetings and timetable occurrences.",
  },
  {
    id: "notes.read",
    name: "Read Notes",
    category: "notes",
    access: "read",
    description: "Search or read Markdown notes.",
  },
  {
    id: "courseMaterials.read",
    name: "Read Course Materials",
    category: "courseMaterials",
    access: "read",
    description: "Read materials associated with a course.",
  },
  {
    id: "tasks.proposeCreate",
    name: "Propose Task Creation",
    category: "tasks",
    access: "proposal",
    description: "Propose creating a new task for user review.",
  },
  {
    id: "tasks.proposeUpdate",
    name: "Propose Task Update",
    category: "tasks",
    access: "proposal",
    description: "Propose modifying task title, deadline, priority, or course.",
  },
  {
    id: "tasks.proposeComplete",
    name: "Propose Task Completion",
    category: "tasks",
    access: "proposal",
    description: "Propose marking a task as completed.",
  },
  {
    id: "tasks.proposeReschedule",
    name: "Propose Task Reschedule",
    category: "tasks",
    access: "proposal",
    description: "Propose updating task planned work interval.",
  },
  {
    id: "tasks.proposeDelete",
    name: "Propose Task Deletion",
    category: "tasks",
    access: "proposal",
    description: "Propose deleting a task.",
  },
  {
    id: "calendar.proposeCreate",
    name: "Propose Calendar Event Creation",
    category: "calendar",
    access: "proposal",
    description: "Propose creating a new calendar event for user review.",
  },
  {
    id: "calendar.proposeUpdate",
    name: "Propose Calendar Event Update",
    category: "calendar",
    access: "proposal",
    description: "Propose updating an existing calendar event.",
  },
  {
    id: "notes.proposeCreate",
    name: "Propose Note Creation",
    category: "notes",
    access: "proposal",
    description: "Propose creating a note for user review.",
  },
  {
    id: "notes.proposeUpdate",
    name: "Propose Note Update",
    category: "notes",
    access: "proposal",
    description: "Propose updating an existing note.",
  },
  {
    id: "courses.proposeCreate",
    name: "Propose Course Creation",
    category: "courses",
    access: "proposal",
    description: "Propose creating a new course from parsed syllabus/document.",
  },
  {
    id: "courses.proposeUpdate",
    name: "Propose Course Update",
    category: "courses",
    access: "proposal",
    description: "Propose updating course metadata.",
  },
  {
    id: "courseMaterials.proposeAssociate",
    name: "Propose Task-Material Link",
    category: "courseMaterials",
    access: "proposal",
    description: "Propose linking a task to a course material.",
  },
];

/**
 * Maps a proposed AI action to its required Redline capability.
 */
export function mapActionToCapability(action: ProposedAiAction): RedlineCapabilityId {
  switch (action.type) {
    case "list_tasks":
      return "tasks.read";
    case "create_task":
      return "tasks.proposeCreate";
    case "update_task":
      return "tasks.proposeUpdate";
    case "complete_task":
      return "tasks.proposeComplete";
    case "delete_task":
      return "tasks.proposeDelete";
    case "reschedule_task":
      return "tasks.proposeReschedule";
    case "list_events":
      return "calendar.read";
    case "create_event":
      return "calendar.proposeCreate";
    case "create_note":
      return "notes.proposeCreate";
    case "search_notes":
      return "notes.read";
    case "get_free_time":
      return "calendar.read";
    case "schedule_task":
      return "tasks.proposeReschedule";
    case "propose_plan":
      return "tasks.proposeReschedule";
    case "send_to_notion":
      return "notes.proposeUpdate";
    case "propose_course":
      return "courses.proposeCreate";
    case "associate_course_material":
      return "courseMaterials.proposeAssociate";
  }
}

export type CapabilityEvaluationResult =
  | { allowed: true; capability: CapabilityDescriptor; isMutation: boolean }
  | { allowed: false; reason: string };

/**
 * Evaluates whether an action is permitted under the declared capabilities.
 * Enforces that no mutation can bypass the proposal review gate.
 */
export function evaluateCapability(
  action: ProposedAiAction,
  enabledCapabilities: ReadonlySet<RedlineCapabilityId> = new Set(REDLINE_CAPABILITIES),
): CapabilityEvaluationResult {
  const capId = mapActionToCapability(action);
  const descriptor = CAPABILITY_CATALOG.find((c) => c.id === capId);

  if (!descriptor) {
    return {
      allowed: false,
      reason: `Unknown or unsupported capability "${capId}".`,
    };
  }

  if (!enabledCapabilities.has(capId)) {
    return {
      allowed: false,
      reason: `Capability "${capId}" is not enabled for this request.`,
    };
  }

  const isMutation = isMutatingAiAction(action);
  return {
    allowed: true,
    capability: descriptor,
    isMutation,
  };
}
