import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignmentEmail } from "@/services/integrations/blackboard/fixtures/email-fixtures";

vi.mock("server-only", () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/services/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { POST } from "./route";

const owner = "11111111-1111-4111-8111-111111111111";
const password = "test-webhook-password-that-is-long-enough";
const auth = `Basic ${Buffer.from(`school:${password}`).toString("base64")}`;
function request(payload: unknown = assignmentEmail(), headers: Record<string, string> = {}) {
  return new Request("https://forward.example.com/api/inbound/postmark", { method: "POST", headers: { "content-type": "application/json", authorization: auth, ...headers }, body: JSON.stringify(payload) });
}
describe("Postmark authenticated inbound route", () => {
  beforeEach(() => {
    vi.stubEnv("SCHOOL_EMAIL_OWNER_ID", owner);
    vi.stubEnv("SCHOOL_EMAIL_RECIPIENT", "school@inbound.example.com");
    vi.stubEnv("SCHOOL_BLACKBOARD_SENDERS", "notifications@learn.example.edu");
    vi.stubEnv("SCHOOL_EMAIL_FORWARDERS", "student@example.edu");
    vi.stubEnv("SCHOOL_BLACKBOARD_HOSTS", "learn.example.edu");
    vi.stubEnv("POSTMARK_WEBHOOK_USERNAME", "school");
    vi.stubEnv("POSTMARK_WEBHOOK_PASSWORD", password);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockReset().mockResolvedValue({ data: { status: "processed", eventId: "event", itemId: "item", taskId: "task" }, error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("binds the configured owner and passes normalized School evidence, never the vendor payload", async () => {
    const response = await POST(request({ ...assignmentEmail(), user_id: "attacker" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("ingest_school_email", expect.objectContaining({ p_user_id: owner, p_event: expect.objectContaining({ itemType: "assignment", title: "Assignment 1" }) }));
    const event = rpc.mock.calls[0][1].p_event;
    expect(event).not.toHaveProperty("TextBody");
    expect(event).not.toHaveProperty("html");
    expect(JSON.stringify(event)).not.toContain(password);
    expect(await response.json()).toEqual({ ok: true, status: "processed" });
  });
  it("rejects invalid authentication before processing payloads", async () => {
    expect((await POST(request({}, { authorization: "Basic invalid" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed when setup is missing", async () => {
    vi.stubEnv("SCHOOL_EMAIL_OWNER_ID", "");
    expect((await POST(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ignores other recipients and persists untrusted deliveries only as ignored", async () => {
    expect((await POST(request(assignmentEmail({ OriginalRecipient: "other@example.com" })))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    await POST(request(assignmentEmail({ Headers: [] })));
    expect(rpc.mock.calls[0][1].p_event).toMatchObject({ status: "ignored", evidence: null });
  });
  it("validates shape, actual body size, and content type", async () => {
    expect((await POST(request({ source: "blackboard", title: "Fake" }))).status).toBe(422);
    expect((await POST(request(assignmentEmail(), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ body: "x".repeat(600_000) }, { "content-length": "20" }))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns retryable failure with redacted logs when the transaction fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret database details" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, code: "ingestion_failed" });
    expect(console.error).toHaveBeenCalledWith("[school-email]", { code: "ingestion_failed" });
  });
});
