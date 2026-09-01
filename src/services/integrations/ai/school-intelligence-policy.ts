import { AiTrustError } from "./trust-contract";

export const SCHOOL_INTELLIGENCE_UNAVAILABLE =
  "This AI capability remains unavailable pending its dedicated trust repair. Nothing was sent or changed. Manual editing and active reviewed imports remain available.";

/**
 * Deliberate quarantine for capabilities not registered by a completed repair.
 * It is code authority, not an environment or preference toggle.
 */
export function schoolIntelligenceUnavailable(): void {
  throw new AiTrustError("school_intelligence_review_required");
}
