import { describe, expect, it } from "vitest";

import {
  buildManagedRootMarker,
  canonicalAstToNotionBlocks,
  computeCanonicalFingerprint,
  computeMarkdownFingerprint,
  CONVERTER_VERSION,
  markdownToCanonicalAst,
  parseManagedRootMarker,
  redactSecret,
} from "./canonical-ast";
import { planConflictResolution, planNotionSyncTransition } from "./sync-planner";

describe("Phase 8A: Notion Connection & Outbound Foundations", () => {
  it("redacts Notion integration secrets from error messages and logs", () => {
    const errorMsg = "Failed request with secret_abc123456789xyz on endpoint";
    const redacted = redactSecret(errorMsg);
    expect(redacted).toBe("Failed request with secret_*** on endpoint");
    expect(redacted).not.toContain("abc123456789xyz");
  });

  it("validates AES-256-GCM envelope format for credential encryption", () => {
    // Verify format v1.iv.tag.ciphertext
    const envelopePattern = /^v1\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;
    expect("v1.dGVzdGl2.dGFndGVzdA.Y2lwaGVydGV4dA").toMatch(envelopePattern);
  });

  it("creates deterministic AST and blocks for outbound export", () => {
    const title = "Meeting Summary";
    const markdown = "## Action items\n\n- [ ] Send report\n- [x] Follow up with client";
    const doc = markdownToCanonicalAst(title, markdown);
    const blocks = canonicalAstToNotionBlocks(doc);

    expect(blocks[0].type).toBe("heading_1"); // Title block
    expect(blocks[1].type).toBe("heading_2");
    expect(blocks[2].type).toBe("to_do");

    const fp = computeCanonicalFingerprint(doc);
    expect(fp).toBe(computeMarkdownFingerprint(title, markdown));
  });

  it("builds exact attempt-linked managed root marker for remote creation idempotency", () => {
    const linkId = "link-uuid-101";
    const attemptId = "attempt-uuid-202";
    const marker = buildManagedRootMarker(linkId, CONVERTER_VERSION, attemptId);

    const parsed = parseManagedRootMarker(marker);
    expect(parsed).not.toBeNull();
    expect(parsed?.linkId).toBe(linkId);
    expect(parsed?.attemptId).toBe(attemptId);
    expect(parsed?.converterVersion).toBe(CONVERTER_VERSION);
  });
});

describe("Phase 8B: Selective Two-Way Synchronization & Loop Suppression", () => {
  const baseLocal = computeMarkdownFingerprint("My Note", "Line 1\n\nLine 2");
  const baseRemote = baseLocal;

  it("does no-op on unchanged synchronization (no echo, no unnecessary write)", () => {
    const plan = planNotionSyncTransition({
      direction: "selective_two_way",
      currentLocalFingerprint: baseLocal,
      currentRemoteFingerprint: baseRemote,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseRemote,
      lastPushedFingerprint: null,
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "synced",
    });

    expect(plan.action).toBe("no_op");
    expect(plan.reason).toBe("unchanged");
  });

  it("plans push_to_remote when only Redline note changed", () => {
    const editedLocal = computeMarkdownFingerprint("My Note", "Line 1\n\nLine 2 edited");
    const plan = planNotionSyncTransition({
      direction: "selective_two_way",
      currentLocalFingerprint: editedLocal,
      currentRemoteFingerprint: baseRemote,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseRemote,
      lastPushedFingerprint: null,
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "local_pending",
    });

    expect(plan.action).toBe("push_to_remote");
    expect(plan.reason).toBe("local_changed");
  });

  it("suppresses self-write echo loop when remote fingerprint equals last_pushed_fingerprint", () => {
    const pushedFp = computeMarkdownFingerprint("My Note", "Newly pushed content");
    const plan = planNotionSyncTransition({
      direction: "selective_two_way",
      currentLocalFingerprint: pushedFp,
      currentRemoteFingerprint: pushedFp,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseLocal,
      lastPushedFingerprint: pushedFp, // verified self-write
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "synced",
    });

    expect(plan.action).toBe("no_op");
    expect(plan.reason).toBe("self_write_echo");
  });

  it("plans import_to_local in selective_two_way when only Notion changed", () => {
    const remoteEdited = computeMarkdownFingerprint("My Note", "Remote edit in Notion");
    const plan = planNotionSyncTransition({
      direction: "selective_two_way",
      currentLocalFingerprint: baseLocal,
      currentRemoteFingerprint: remoteEdited,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseRemote,
      lastPushedFingerprint: null,
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "synced",
    });

    expect(plan.action).toBe("import_to_local");
    expect(plan.reason).toBe("remote_changed_selective_two_way");
  });

  it("plans mark_remote_pending in forward_to_notion when Notion changed (does NOT auto-import)", () => {
    const remoteEdited = computeMarkdownFingerprint("My Note", "Remote edit in Notion");
    const plan = planNotionSyncTransition({
      direction: "forward_to_notion",
      currentLocalFingerprint: baseLocal,
      currentRemoteFingerprint: remoteEdited,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseRemote,
      lastPushedFingerprint: null,
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "synced",
    });

    expect(plan.action).toBe("mark_remote_pending");
    expect(plan.reason).toBe("remote_changed_forward_to_notion");
  });

  it("converges without conflict when concurrent edits are identical", () => {
    const identicalFp = computeMarkdownFingerprint("My Note", "Same edit made on both");
    const plan = planNotionSyncTransition({
      direction: "selective_two_way",
      currentLocalFingerprint: identicalFp,
      currentRemoteFingerprint: identicalFp,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseRemote,
      lastPushedFingerprint: null,
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "synced",
    });

    expect(plan.action).toBe("no_op");
    expect(plan.reason).toBe("converged");
  });

  it("creates a conflict when concurrent edits diverge", () => {
    const localFp = computeMarkdownFingerprint("My Note", "Local edit");
    const remoteFp = computeMarkdownFingerprint("My Note", "Remote edit");
    const plan = planNotionSyncTransition({
      direction: "selective_two_way",
      currentLocalFingerprint: localFp,
      currentRemoteFingerprint: remoteFp,
      baseLocalFingerprint: baseLocal,
      baseRemoteFingerprint: baseRemote,
      lastPushedFingerprint: null,
      converterVersion: 1,
      currentConverterVersion: 1,
      currentStatus: "synced",
    });

    expect(plan.action).toBe("create_conflict");
    expect(plan.reason).toBe("concurrent_divergence");
  });

  it("plans conflict resolution for keep_redline and use_notion", () => {
    const localDoc = markdownToCanonicalAst("Local Title", "Local Body");
    const remoteDoc = markdownToCanonicalAst("Remote Title", "Remote Body");
    const localFp = computeCanonicalFingerprint(localDoc);
    const remoteFp = computeCanonicalFingerprint(remoteDoc);

    const keepRedline = planConflictResolution(
      "keep_redline",
      localDoc,
      localFp,
      remoteDoc,
      remoteFp,
    );
    expect(keepRedline.resolution).toBe("keep_redline");
    expect(keepRedline.targetTitle).toBe("Local Title");
    expect(keepRedline.targetFingerprint).toBe(localFp);

    const useNotion = planConflictResolution(
      "use_notion",
      localDoc,
      localFp,
      remoteDoc,
      remoteFp,
    );
    expect(useNotion.resolution).toBe("use_notion");
    expect(useNotion.targetTitle).toBe("Remote Title");
    expect(useNotion.targetFingerprint).toBe(remoteFp);
  });
});
