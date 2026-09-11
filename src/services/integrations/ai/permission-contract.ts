import { isMutatingAiAction, type ProposedAiAction } from "./action-contract";

export const aiPermissionModes = [
  "suggest_only",
  "ask_before_changing",
  "trusted_automation",
] as const;

export type AiPermissionMode = (typeof aiPermissionModes)[number];
export type AiExecutionDecision = "allow_read" | "allow_mutation" | "needs_confirmation" | "deny";

export const defaultAiPermissionMode: AiPermissionMode = "ask_before_changing";

/** Presentation decision only; signed, persisted SQL approval remains authoritative. */
export function decideAiExecution(
  action: ProposedAiAction,
  mode: AiPermissionMode = defaultAiPermissionMode,
  userConfirmed = false,
): AiExecutionDecision {
  if (!isMutatingAiAction(action)) return "allow_read";
  // Phase 11 automation is deferred. Match the active Phase 10A SQL policy;
  // neither provider selection nor a browser confirmation boolean enables it.
  if (mode !== "ask_before_changing") return "deny";
  if (!userConfirmed) return "needs_confirmation";
  return "allow_mutation";
}
