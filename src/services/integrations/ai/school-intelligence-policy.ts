import { AiTrustError } from "./trust-contract";

export const SCHOOL_INTELLIGENCE_UNAVAILABLE =
  "School Intelligence AI is unavailable pending its security review fixes. Nothing was sent or changed. Manual editing and reviewed text course import remain available.";

/**
 * Deliberate quarantine, not an environment toggle. The signed repair still lacks
 * canonical source freshness, consistent strict review contracts, and safe domain
 * identity/confirmation semantics. Keep denial until independently verified;
 * the final containment migration also blocks existing reviews and attempts.
 */
export function schoolIntelligenceUnavailable(): void {
  throw new AiTrustError("school_intelligence_review_required");
}
