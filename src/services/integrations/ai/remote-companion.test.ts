import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), attempt: vi.fn(), source: vi.fn(), rpc: vi.fn() }));
vi.mock("@/services/supabase/request", () => ({ requireAuthenticatedSupabase: mocks.auth }));
vi.mock("./inference-router", () => ({ loadInferenceAttempt: mocks.attempt }));
vi.mock("./inference-source", () => ({ readInferenceSource: mocks.source }));
vi.mock("./trust-signing", () => ({ signAiCommand: (_owner: string, operation: string, data: unknown) => ({ operation, data }) }));
import { CompanionTicketVerifier } from "@/companion/request-ticket";
import { remoteInferenceTicket, remoteSessionTicket } from "./remote-companion";

const owner = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const key = "ab".repeat(32), remote = "https://home.fixture.ts.net", origin = "https://forward.example";
const token = "fwd_comp_" + "cd".repeat(32);
const inference = { model: "fixture", prompt: "Canonical bounded source", formatJson: true };
const attempt = { id: owner, kind: "checklist", requestId: device, model: "fixture", provider: "ollama", location: "remote_local", status: "dispatching", payload_digest: "x" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN", remote);
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("COMPANION_REQUEST_SIGNING_KEY", key);
  mocks.auth.mockResolvedValue({ userId: owner, client: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.attempt.mockResolvedValue(attempt);
  mocks.source.mockResolvedValue({ inference, digest: "x" });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated remote request tickets", () => {
  it("requires authenticated Redline identity before session ticket signing", async () => {
    mocks.auth.mockRejectedValue(new Error("unauthorized"));
    await expect(remoteSessionTicket("/health", null, null, device)).rejects.toThrow();
  });
  it("binds configured audience/origin, authenticated owner and tab device without exposing its signing key", async () => {
    const signed = await remoteSessionTicket("/health", null, null, device);
    const verified = new CompanionTicketVerifier(key, remote).verify(signed, origin, "/health", null);
    expect(verified).toMatchObject({ userId: owner, deviceId: device, capability: "session" });
    expect(JSON.stringify(verified)).not.toContain(key);
    expect(signed).not.toContain(key);
  });
  it.each(["/v1/infer", "/admin", "https://evil.example"])("session tickets cannot authorize %s", async path => {
    await expect(remoteSessionTicket(path, {}, null, device)).rejects.toThrow("capability_denied");
  });
  it("rejects browser proxy URLs and extra status fields before signing", async () => {
    await expect(remoteSessionTicket("/v1/status", { provider: "ollama", endpoint: "http://192.168.1.1" }, token, device)).rejects.toThrow();
    await expect(remoteSessionTicket("/v1/status", { provider: "ollama", endpoint: "http://127.0.0.1:11434", prompt: "escape" }, token, device)).rejects.toThrow();
  });
  it("signs only reconstructed inference and consumes one-use issuance", async () => {
    const signed = await remoteInferenceTicket(owner, "http://127.0.0.1:11434", token, device);
    const body = { provider: "ollama", endpoint: "http://127.0.0.1:11434/", request: inference };
    expect(new CompanionTicketVerifier(key, remote).verify(signed, origin, "/v1/infer", body, token).capability).toBe("taskChecklist.propose");
    expect(mocks.source).toHaveBeenCalledWith("checklist", device, "fixture");
    expect(mocks.rpc).toHaveBeenCalledWith("ai_claim_remote_ticket", { operation: "claim_remote_ticket", data: { id: owner } });
    mocks.rpc.mockResolvedValue({ error: { message: "already issued" } });
    await expect(remoteInferenceTicket(owner, "http://127.0.0.1:11434", token, device)).rejects.toThrow("request_unavailable");
  });
  it.each(["cloud", "local"])("cannot mint a remote inference ticket for %s attempts", async location => {
    mocks.attempt.mockResolvedValue({ ...attempt, location });
    await expect(remoteInferenceTicket(owner, "http://127.0.0.1:11434", token, device)).rejects.toThrow("capability_denied");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects source digest drift and missing signing configuration", async () => {
    mocks.source.mockResolvedValue({ inference, digest: "changed" });
    await expect(remoteInferenceTicket(owner, "http://127.0.0.1:11434", token, device)).rejects.toThrow("source_changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv("COMPANION_REQUEST_SIGNING_KEY", "");
    await expect(remoteSessionTicket("/health", null, null, device)).rejects.toThrow("remote_not_configured");
  });
});
