import { describe, expect, it } from "vitest";

import { CONVERTER_VERSION } from "./canonical-ast";
import { planNotionSyncTransition } from "./sync-planner";
import type { SyncPlannerInput } from "./sync-planner";

describe("Notion Sync Transition Planner & Loop Suppression", () => {
  const baseFp = "base-hash-111";
  const localEditedFp = "local-hash-222";
  const remoteEditedFp = "remote-hash-333";

  const defaultInput: SyncPlannerInput = {
    direction: "selective_two_way",
    currentLocalFingerprint: baseFp,
    currentRemoteFingerprint: baseFp,
    baseLocalFingerprint: baseFp,
    baseRemoteFingerprint: baseFp,
    lastPushedFingerprint: null,
    converterVersion: CONVERTER_VERSION,
    currentConverterVersion: CONVERTER_VERSION,
    currentStatus: "synced",
  };

  it("plans no-op when neither local nor remote changed", () => {
    const decision = planNotionSyncTransition(defaultInput);
    expect(decision).toEqual({ action: "no_op", reason: "unchanged" });
  });

  it("plans push_to_remote when only local note changed", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      currentLocalFingerprint: localEditedFp,
    });
    expect(decision).toEqual({ action: "push_to_remote", reason: "local_changed" });
  });

  it("plans import_to_local when only remote changed in selective_two_way mode", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      direction: "selective_two_way",
      currentRemoteFingerprint: remoteEditedFp,
    });
    expect(decision).toEqual({
      action: "import_to_local",
      reason: "remote_changed_selective_two_way",
    });
  });

  it("plans mark_remote_pending when only remote changed in forward_to_notion mode", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      direction: "forward_to_notion",
      currentRemoteFingerprint: remoteEditedFp,
    });
    expect(decision).toEqual({
      action: "mark_remote_pending",
      reason: "remote_changed_forward_to_notion",
    });
  });

  it("suppresses loop echo when remote fingerprint equals last_pushed_fingerprint", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      currentRemoteFingerprint: "pushed-fingerprint-444",
      lastPushedFingerprint: "pushed-fingerprint-444",
    });
    expect(decision).toEqual({ action: "no_op", reason: "self_write_echo" });
  });

  it("recognizes converged edits when both changed to identical content", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      currentLocalFingerprint: "identical-edit-555",
      currentRemoteFingerprint: "identical-edit-555",
    });
    expect(decision).toEqual({ action: "no_op", reason: "converged" });
  });

  it("detects genuine concurrent conflict when both changed to different content", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      currentLocalFingerprint: localEditedFp,
      currentRemoteFingerprint: remoteEditedFp,
    });
    expect(decision).toEqual({ action: "create_conflict", reason: "concurrent_divergence" });
  });

  it("routes to upgrade_review on converter version mismatch", () => {
    const decision = planNotionSyncTransition({
      ...defaultInput,
      converterVersion: 1,
      currentConverterVersion: 2,
    });
    expect(decision).toEqual({
      action: "upgrade_review",
      reason: "converter_version_mismatch",
    });
  });
});
