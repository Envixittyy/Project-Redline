import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutedPreparation } from "@/services/integrations/ai/routing-contract";
const m = vi.hoisted(() => ({ prepare: vi.fn(), claim: vi.fn(), finalize: vi.fn(), send: vi.fn(), fail: vi.fn(), cancel: vi.fn(), fallback: vi.fn(), infer: vi.fn(), ticket: vi.fn() }));
vi.mock("./routing-actions", () => ({ prepareRoutedInferenceAction: m.prepare, claimLocalInferenceAction: m.claim, finalizeLocalInferenceAction: m.finalize,
  sendCloudInferenceAction: m.send, failLocalInferenceAction: m.fail, cancelInferenceAction: m.cancel, prepareFallbackAction: m.fallback }));
vi.mock("./remote-companion-actions", () => ({ remoteInferenceTicketAction: m.ticket }));
vi.mock("@/services/integrations/ai/companion-client", () => ({ inferLocalContent: m.infer, companionDeviceId: () => "device",
  LocalCompanionClientError: class extends Error { constructor(message: string, public code = "invalid_output") { super(message); } } }));
import { LocalCompanionClientError } from "@/services/integrations/ai/companion-client";
import { generateRoutedProposal } from "./routing-client";
const local: RoutedPreparation = { kind: "checklist", attemptId: "local", requestId: "source", provider: "ollama", model: "test", location: "local", disclosure: { purpose: "taskChecklist.propose", fields: ["title"], sources: 1, bytes: 100, expiresAt: "soon" } };
const cloud = (provider: "gemini" | "openrouter"): RoutedPreparation => ({ ...local, provider, attemptId: provider, location: "cloud" });
const config = { enabled: true, companionUrl: "http://127.0.0.1:41400", provider: "ollama" as const, model: "test", endpoint: "http://127.0.0.1:11434", pairingToken: "token" };
beforeEach(() => { vi.clearAllMocks(); m.prepare.mockResolvedValue({ ok: true, prepared: local }); m.claim.mockResolvedValue({ ok: true, inference: { prompt: "server canonical", model: "test" } });
  m.infer.mockResolvedValue("raw"); m.finalize.mockResolvedValue({ ok: true, review: { batchId: "review" } }); m.fail.mockResolvedValue({ ok: true }); m.cancel.mockResolvedValue({ ok: true });
  m.fallback.mockResolvedValue({ ok: false, code: "cloud_disabled" }); });
describe("actual shared browser routing orchestration", () => {
  it("uses canonical local inference and finalizes only by attempt ID, without any cloud call", async () => {
    const consent = vi.fn(); expect((await generateRoutedProposal("checklist", "task", config, undefined, consent)).ok).toBe(true);
    expect(m.infer).toHaveBeenCalledWith(config, { prompt: "server canonical", model: "test" }, undefined, undefined);
    expect(m.finalize).toHaveBeenCalledWith("local", "raw"); expect(consent).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it("cancelled disclosure sends nothing", async () => {
    m.prepare.mockResolvedValue({ ok: true, prepared: cloud("gemini") }); const consent = vi.fn(async () => false);
    expect((await generateRoutedProposal("course", new FormData(), null, undefined, consent)).ok).toBe(false);
    expect(consent).toHaveBeenCalledWith(cloud("gemini")); expect(m.send).not.toHaveBeenCalled(); expect(m.cancel).toHaveBeenCalledWith("gemini");
  });
  it("local -> Gemini failure -> OpenRouter each requires its own consent", async () => {
    m.infer.mockRejectedValue(new LocalCompanionClientError("offline", "provider_unavailable"));
    m.fallback.mockResolvedValueOnce({ ok: true, prepared: cloud("gemini") }).mockResolvedValueOnce({ ok: true, prepared: cloud("openrouter") });
    m.send.mockResolvedValueOnce({ ok: false, code: "rate_limited", message: "rate limited" }).mockResolvedValueOnce({ ok: true, review: { batchId: "r", provenance: { provider: "openrouter" } } });
    const consent = vi.fn(async () => true);
    expect((await generateRoutedProposal("checklist", "task", config, undefined, consent)).ok).toBe(true);
    expect(consent.mock.calls).toHaveLength(2); expect(m.send.mock.calls).toEqual([["gemini"], ["openrouter"]]);
  });
  it("unpaired local may offer cloud but cannot upload without consent", async () => {
    m.fallback.mockResolvedValueOnce({ ok: true, prepared: cloud("gemini") });
    expect((await generateRoutedProposal("checklist", "task", null, undefined, async () => false)).ok).toBe(false);
    expect(m.infer).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it.each(["pairing_invalid", "invalid_output", "provider_rejected", "cancelled"])("does not retry local %s", async code => {
    m.infer.mockRejectedValue(new LocalCompanionClientError("private secret", code));
    expect((await generateRoutedProposal("checklist", "task", config)).ok).toBe(false); expect(m.fallback).not.toHaveBeenCalled();
  });
  it("never regenerates after finalization failure", async () => {
    m.finalize.mockResolvedValue({ ok: false, code: "source_changed" });
    expect((await generateRoutedProposal("checklist", "task", config)).ok).toBe(false); expect(m.fallback).not.toHaveBeenCalled();
  });
  it("aborting before send cannot trigger cloud", async () => {
    m.prepare.mockResolvedValue({ ok: true, prepared: cloud("gemini") });
    expect((await generateRoutedProposal("checklist", "task", null, AbortSignal.abort(), async () => true)).ok).toBe(false); expect(m.send).not.toHaveBeenCalled();
  });
});
