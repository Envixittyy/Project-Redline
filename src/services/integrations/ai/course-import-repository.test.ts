import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  apply: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: mocks.auth,
}));
vi.mock("@/services/courses/course-repository", () => ({
  applyReviewedCourseImport: mocks.apply,
}));
import {
  approveCourseImport,
  finalizeCourseImport,
  prepareCourseImport,
  reviseCourseImport,
} from "./course-import-repository";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "33333333-3333-4333-8333-333333333333";
const handle = "document_" + "a".repeat(32);
const proposal = {
  schema_version: 1,
  type: "create_course",
  source_handle: handle,
  course: {
    code: "CS101",
    name: "CS",
    instructor: null,
    location: null,
    meetings: [],
  },
};
function query(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data }),
    maybeSingle: vi.fn().mockResolvedValue({ data }),
  };
}
function review() {
  return {
    batchId: id,
    input: proposal,
    sourceHandle: handle,
    capability: "courseImport.propose",
    proposalDigest: "a".repeat(64),
    status: "proposed",
    fileName: "course.txt",
    startDate: "2026-08-31",
    timeZone: "Asia/Manila",
  };
}
describe("server-owned course request and review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_TRUST_SIGNING_KEY", "07".repeat(32));
    mocks.auth.mockResolvedValue({
      userId: owner,
      client: { rpc: mocks.rpc, from: mocks.from },
    });
    mocks.rpc.mockResolvedValue({ error: null });
  });
  it("authenticates before extraction and rejects browser context objects or unsupported providers", async () => {
    await expect(
      prepareCourseImport(
        { text: "forged" } as unknown as FormData,
        "ollama",
        "test",
      ),
    ).rejects.toThrow("invalid_document");
    await expect(
      prepareCourseImport(new FormData(), "cloud", "test"),
    ).rejects.toThrow("invalid_provider");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.auth.mockRejectedValue(new Error("unauthorized"));
    await expect(
      prepareCourseImport(new FormData(), "ollama", "test"),
    ).rejects.toThrow("unauthorized");
  });
  it("extracts selected bytes on server, ignores extra browser metadata, and prompts from the persisted reread", async () => {
    const form = new FormData();
    form.set("file", new File(["Upload\r\nCS101"], "syllabus.txt"));
    form.set("source_text", "forged");
    form.set("capability", "course.delete");
    form.set("start_date", "1900-01-01");
    mocks.from.mockReturnValue(
      query({
        source_text: "Persisted canonical source",
        source_handle: handle,
        model: "test",
        start_date: "2026-08-31",
        time_zone: "Asia/Manila",
      }),
    );
    const result = await prepareCourseImport(form, "ollama", "test");
    const signed = JSON.parse(mocks.rpc.mock.calls[0][1].p_message);
    expect(signed.data).toMatchObject({
      capability: "courseImport.propose",
      source_text: "Upload\nCS101",
      source_digest: createHash("sha256").update("Upload\nCS101").digest("hex"),
    });
    expect(signed.data.start_date).not.toBe("1900-01-01");
    expect(result.inference.prompt).toContain("Persisted canonical source");
    expect(result.inference.prompt).not.toContain("forged");
    expect(JSON.stringify(result)).not.toContain("p_mac");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("finalization refuses stale immutable source before it can persist a review", async () => {
    mocks.from.mockReturnValue(
      query({
        id,
        source_text: "changed",
        source_digest: "0".repeat(64),
        source_handle: handle,
        capability: "courseImport.propose",
        status: "prepared",
        expires_at: new Date(Date.now() + 300000).toISOString(),
      }),
    );
    await expect(
      finalizeCourseImport(id, JSON.stringify(proposal)),
    ).rejects.toThrow("source_changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("approval loads persisted review then delegates signed digest to the normal course repository", async () => {
    mocks.rpc.mockResolvedValue({ data: review() });
    mocks.apply.mockResolvedValue({ ok: true });
    await expect(
      approveCourseImport({ batchId: id, proposal }),
    ).rejects.toThrow("invalid_id");
    await approveCourseImport(id);
    expect(mocks.rpc).toHaveBeenCalledWith("ai_read_course_review", {
      p_batch_id: id,
    });
    const signed = JSON.parse(mocks.apply.mock.calls[0][0].p_message);
    expect(signed).toMatchObject({
      operation: "approve_course",
      user_id: owner,
      data: { batch_id: id, proposal_digest: "a".repeat(64) },
    });
    expect(signed.data).not.toHaveProperty("course");
  });
  it("edited fields cannot replace source identity/capability and never execute an import", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: review() })
      .mockResolvedValueOnce({ data: id })
      .mockResolvedValueOnce({ data: review() });
    await reviseCourseImport(id, { ...proposal.course, name: "Edited" });
    const signed = JSON.parse(mocks.rpc.mock.calls[1][1].p_message);
    expect(signed).toMatchObject({
      operation: "revise_course",
      data: {
        proposal: {
          source_handle: handle,
          type: "create_course",
          course: { name: "Edited" },
        },
      },
    });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
