import type {
  CanonicalDocument,
  NotionConflictResolution,
  NotionPageLinkStatus,
  NotionSyncDirection,
} from "./types";

export type SyncPlannerInput = {
  direction: NotionSyncDirection;
  currentLocalFingerprint: string;
  currentRemoteFingerprint: string;
  baseLocalFingerprint: string | null;
  baseRemoteFingerprint: string | null;
  lastPushedFingerprint: string | null;
  converterVersion: number;
  currentConverterVersion: number;
  currentStatus: NotionPageLinkStatus;
};

export type SyncPlannerDecision =
  | { action: "no_op"; reason: "unchanged" | "self_write_echo" | "converged" }
  | { action: "push_to_remote"; reason: "local_changed" }
  | { action: "import_to_local"; reason: "remote_changed_selective_two_way" }
  | { action: "mark_remote_pending"; reason: "remote_changed_forward_to_notion" }
  | { action: "create_conflict"; reason: "concurrent_divergence" }
  | { action: "upgrade_review"; reason: "converter_version_mismatch" };

/**
 * Pure transition planner for Notion synchronization.
 * Evaluates local and remote state against established baselines, applying
 * loop-suppression fingerprints, converged-edit detection, and direction constraints.
 */
export function planNotionSyncTransition(
  input: SyncPlannerInput,
): SyncPlannerDecision {
  // 1. Converter version check
  if (input.converterVersion !== input.currentConverterVersion) {
    return { action: "upgrade_review", reason: "converter_version_mismatch" };
  }

  // 2. Base established? If not, first push is required
  if (!input.baseLocalFingerprint || !input.baseRemoteFingerprint) {
    return { action: "push_to_remote", reason: "local_changed" };
  }

  // 3. Self-write echo suppression:
  // If remote fingerprint matches what we last pushed and local is at that same fingerprint,
  // it is Forward's own write echoing back.
  const isSelfWrite =
    input.lastPushedFingerprint !== null &&
    input.currentRemoteFingerprint === input.lastPushedFingerprint;

  if (isSelfWrite && input.currentLocalFingerprint === input.lastPushedFingerprint) {
    return { action: "no_op", reason: "self_write_echo" };
  }

  const localChanged =
    input.currentLocalFingerprint !== input.baseLocalFingerprint;
  const remoteChanged =
    !isSelfWrite &&
    input.currentRemoteFingerprint !== input.baseRemoteFingerprint;

  // 4. Evaluate transition matrix
  if (!localChanged && !remoteChanged) {
    return {
      action: "no_op",
      reason: isSelfWrite ? "self_write_echo" : "unchanged",
    };
  }

  if (localChanged && !remoteChanged) {
    return { action: "push_to_remote", reason: "local_changed" };
  }

  if (!localChanged && remoteChanged) {
    if (input.direction === "selective_two_way") {
      return {
        action: "import_to_local",
        reason: "remote_changed_selective_two_way",
      };
    }
    return {
      action: "mark_remote_pending",
      reason: "remote_changed_forward_to_notion",
    };
  }

  // localChanged && remoteChanged
  // Check for independent convergence
  if (input.currentLocalFingerprint === input.currentRemoteFingerprint) {
    return { action: "no_op", reason: "converged" };
  }

  // True concurrent conflict
  return { action: "create_conflict", reason: "concurrent_divergence" };
}

export type ConflictResolutionPlan = {
  resolution: NotionConflictResolution;
  targetTitle: string;
  targetBody: string;
  targetSnapshot: CanonicalDocument;
  targetFingerprint: string;
};

/** Prepares conflict resolution plan. */
export function planConflictResolution(
  resolution: NotionConflictResolution,
  localDoc: CanonicalDocument,
  localFp: string,
  remoteDoc: CanonicalDocument,
  remoteFp: string,
): ConflictResolutionPlan {
  if (resolution === "use_notion") {
    return {
      resolution: "use_notion",
      targetTitle: remoteDoc.title,
      targetBody: "", // will be serialized to markdown
      targetSnapshot: remoteDoc,
      targetFingerprint: remoteFp,
    };
  }

  return {
    resolution: "keep_redline",
    targetTitle: localDoc.title,
    targetBody: "",
    targetSnapshot: localDoc,
    targetFingerprint: localFp,
  };
}
