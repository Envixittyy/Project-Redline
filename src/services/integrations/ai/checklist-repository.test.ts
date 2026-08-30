import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  context: vi.fn(),
  apply: vi.fn(),
}));
const owner = "11111111-1111-4111-8111-111111111111",
  task = "33333333-3333-4333-8333-333333333333";
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: vi.fn(async () => ({
    userId: "11111111-1111-4111-8111-111111111111",
    client: { rpc: mocks.rpc, from: mocks.from },
  })),
}));
vi.mock("@/services/tasks/task-repository", () => ({
  readTaskChecklistContext: mocks.context,
  applyReviewedTaskChecklist: mocks.apply,
}));
import {
  finalizeTaskChecklist,
  prepareTaskChecklist,
} from "./checklist-repository";
import { signAiCommand } from "./trust-signing";
describe("Server-owned request context and capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_TRUST_SIGNING_KEY", "07".repeat(32));
    mocks.context.mockResolvedValue({
      title: "Canonical DB title",
      description: "Canonical description",
      existingChecklistTitles: [],
      revision: "a".repeat(64),
    });
    mocks.rpc.mockResolvedValue({ error: null });
  });
  it("rejects browser entity objects and unauthorized providers", async () => {
    await expect(
      prepareTaskChecklist({ id: task, title: "forged" }, "ollama", "test"),
    ).rejects.toThrow("invalid_id");
    await expect(
      prepareTaskChecklist(task, "cloud-with-extra-permissions", "test"),
    ).rejects.toThrow("invalid_provider");
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reads canonical entity; signs exact source revision and one capability; returns no DB identity", async () => {
    const prepared = await prepareTaskChecklist(task, "ollama", "test");
    expect(mocks.context).toHaveBeenCalledWith(task);
    expect(prepared.inference.prompt).toContain("Canonical DB title");
    expect(prepared.inference.prompt).not.toContain(task);
    expect(prepared.inference.prompt).not.toContain(owner);
    const message = JSON.parse(mocks.rpc.mock.calls[0][1].p_message);
    expect(message.data).toMatchObject({
      task_id: task,
      source_revision: "a".repeat(64),
      capability: "taskChecklist.propose",
    });
    expect(message.data.task_handle).toMatch(/^task_[a-f0-9]{32}$/);
    expect(JSON.stringify(prepared)).not.toContain("p_mac");
  });
  it("provider/model choice never changes application capability", async () => {
    for (const provider of ["ollama", "llamacpp", "openai_compatible"])
      await prepareTaskChecklist(task, provider, "test");
    expect(
      mocks.rpc.mock.calls.map(
        (c) => JSON.parse(c[1].p_message).data.capability,
      ),
    ).toEqual(Array(3).fill("taskChecklist.propose"));
  });
  it("finalization rereads the entity and refuses stale content before recording a proposal", async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({
          error: null,
          data: {
            id: task,
            task_id: task,
            task_handle: "handle",
            source_revision: "b".repeat(64),
            capability: "taskChecklist.propose",
            status: "prepared",
            expires_at: new Date(Date.now() + 300000).toISOString(),
          },
        }),
    };
    mocks.from.mockReturnValue(builder);
    await expect(finalizeTaskChecklist(task, "{}")).rejects.toThrow(
      "source_changed",
    );
    expect(mocks.context).toHaveBeenCalledWith(task);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("missing signing configuration fails closed", () => {
    vi.stubEnv("AI_TRUST_SIGNING_KEY", "");
    expect(() => signAiCommand(owner, "prepare_checklist", {})).toThrow(
      "trust_not_configured",
    );
  });
});
