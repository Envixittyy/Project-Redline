import { AiTrustError } from "./trust-contract";

export const SCHOOL_INTELLIGENCE_UNAVAILABLE =
  "School Intelligence AI is unavailable pending its security review fixes. Nothing was sent or changed. Manual editing and reviewed text course import remain available.";

/**
 * Deliberate quarantine, not an environment toggle. The feature repositories lack
 * signed source/review persistence and atomic domain approval. Keep this denial
 * until those contracts and their adversarial database tests are implemented.
 */
export function schoolIntelligenceUnavailable(): void {
  throw new AiTrustError("school_intelligence_review_required");
}
