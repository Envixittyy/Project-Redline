import type {
  AiContextEnvelope,
  AiDataClass,
  AiPreferences,
} from "./types";

export type ConsentEvaluationResult =
  | {
      allowed: true;
      mode: "direct_prompt_send" | "needs_transfer_consent";
      dataClasses: AiDataClass[];
    }
  | {
      allowed: false;
      mode: "deny";
      reason: string;
    };

/** Classifies the data elements contained within an AiContextEnvelope. */
export function classifyPayloadData(envelope: AiContextEnvelope): AiDataClass[] {
  const classes = new Set<AiDataClass>();

  if (envelope.prompt && envelope.prompt.trim()) {
    classes.add("direct_prompt");
  }

  if (envelope.items && envelope.items.length > 0) {
    classes.add("private_text");
  }

  if (classes.size === 0) {
    classes.add("direct_prompt");
  }

  return Array.from(classes);
}

/** Evaluates whether an outbound transfer is permissible and whether interactive consent is required. */
export function evaluateTransferConsent(
  envelope: AiContextEnvelope,
  preferences?: Pick<AiPreferences, "cloudEnabled" | "cloudFallbackMode"> | null,
): ConsentEvaluationResult {
  if (preferences && !preferences.cloudEnabled) {
    return {
      allowed: false,
      mode: "deny",
      reason: "Cloud AI features are disabled in settings.",
    };
  }

  if (preferences && preferences.cloudFallbackMode === "off") {
    return {
      allowed: false,
      mode: "deny",
      reason: "Cloud AI fallback is set to Off.",
    };
  }

  const dataClasses = classifyPayloadData(envelope);

  if (dataClasses.includes("private_text") || dataClasses.includes("private_binary")) {
    return {
      allowed: true,
      mode: "needs_transfer_consent",
      dataClasses,
    };
  }

  return {
    allowed: true,
    mode: "direct_prompt_send",
    dataClasses,
  };
}
