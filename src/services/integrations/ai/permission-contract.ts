import { isMutatingAiAction, type ProposedAiAction } from "./action-contract";

export const aiPermissionModes = [
  "suggest_only",
  "ask_before_changing",
  "trusted_automation",
] as const;

export type AiPermissionMode = (typeof aiPermissionModes)[number];
export type AiExecutionDecision = "allow_read" | "allow_mutation" | "needs_confirmation" | "deny";

export const defaultAiPermissionMode: AiPermissionMode = "ask_before_changing";

/** Permission is evaluated after schema and domain validation, never by the model. */
export function decideAiExecution(
  action: ProposedAiAction,
  mode: AiPermissionMode = defaultAiPermissionMode,
  userConfirmed = false,
): AiExecutionDecision {
  if (!isMutatingAiAction(action)) return "allow_read";
  if (mode === "suggest_only") return "deny";
  if (mode === "ask_before_changing" && !userConfirmed) return "needs_confirmation";
  return "allow_mutation";
}
