import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  prepare: vi.fn(),
  finalize: vi.fn(),
  revise: vi.fn(),
  session: vi.fn(),
  infer: vi.fn(),
}));
vi.mock("@/services/integrations/ai/course-import-repository", () => ({
  approveCourseImport: mocks.apply,
  prepareCourseImport: mocks.prepare,
  finalizeCourseImport: mocks.finalize,
  reviseCourseImport: mocks.revise,
  readCourseImportReview: vi.fn(),
  rejectCourseImport: vi.fn(),
}));
vi.mock("@/services/integrations/ai/companion-session", () => ({
  getCompanionSession: mocks.session,
}));
vi.mock("@/services/integrations/ai/companion-client", () => ({
  inferLocalContent: mocks.infer,
}));
import { applyCourseImportAction } from "./course-import-actions";
import { generateCourseImport } from "./course-import-client";
describe("course browser orchestration and approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ provider: "ollama", model: "test" });
  });
  it("approval accepts only a persisted ID and ignores extra browser actions", async () => {
    mocks.apply.mockResolvedValue({ ok: true });
    const endpoint = applyCourseImportAction as (
      ...args: unknown[]
    ) => ReturnType<typeof applyCourseImportAction>;
    expect(await endpoint("batch", { type: "delete_task" })).toEqual({
      ok: true,
    });
    expect(mocks.apply).toHaveBeenCalledWith("batch");
  });
  it("generation uploads selected bytes and runs only the server-produced inference request, then persists untrusted output without applying", async () => {
    const inference = { prompt: "canonical", model: "test" };
    mocks.prepare.mockResolvedValue({ requestId: "request", inference });
    mocks.infer.mockResolvedValue("untrusted output");
    mocks.finalize.mockResolvedValue({ batchId: "review" });
    const file = new File(["CS101"], "course.txt");
    expect((await generateCourseImport(file)).ok).toBe(true);
    expect(mocks.prepare.mock.calls[0][0].get("file")).toBe(file);
    expect(mocks.infer).toHaveBeenCalledWith(
      { provider: "ollama", model: "test" },
      inference,
      undefined,
    );
    expect(mocks.finalize).toHaveBeenCalledWith("request", "untrusted output");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("unpaired, cancelled, and disconnected requests cannot reach application mutation", async () => {
    const file = new File(["CS101"], "course.txt");
    mocks.session.mockReturnValue(null);
    expect((await generateCourseImport(file)).ok).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.session.mockReturnValue({ provider: "ollama", model: "test" });
    mocks.prepare.mockResolvedValue({ requestId: "r", inference: {} });
    expect((await generateCourseImport(file, AbortSignal.abort())).ok).toBe(
      false,
    );
    expect(mocks.infer).not.toHaveBeenCalled();
    mocks.infer.mockRejectedValue(new Error("private detail"));
    expect(JSON.stringify(await generateCourseImport(file))).not.toContain(
      "private detail",
    );
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("application failure is safe and truthful, without leaking database details", async () => {
    mocks.apply.mockRejectedValue(new Error("secret database record"));
    const result = await applyCourseImportAction("batch");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
