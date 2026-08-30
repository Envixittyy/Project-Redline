import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/supabase/request", () => ({
  requireAuthenticatedSupabase: vi.fn(async () => ({
    userId: "owner",
    client: {},
  })),
}));
const approve = vi.hoisted(() => vi.fn());
vi.mock("@/services/integrations/ai/checklist-repository", () => ({
  approveTaskChecklist: approve,
  rejectTaskChecklist: vi.fn(),
}));
import {
  applyAiProposalAction,
  dispatchAiTransferAction,
  prepareAiTransferAction,
} from "./ai-actions";
describe("AI public action security", () => {
  beforeEach(() => vi.clearAllMocks());
  it("forwards only the persisted ID, never extra browser actions", async () => {
    approve.mockResolvedValue({ ok: true });
    const endpoint = applyAiProposalAction as (
      ...args: unknown[]
    ) => ReturnType<typeof applyAiProposalAction>;
    expect(
      (await endpoint("batch", [{ type: "delete_task", task_id: "victim" }]))
        .ok,
    ).toBe(true);
    expect(approve).toHaveBeenCalledWith("batch");
  });
  it("does not expose DB/provider details on failure", async () => {
    approve.mockRejectedValue(new Error("secret private task text"));
    expect(JSON.stringify(await applyAiProposalAction("batch"))).not.toContain(
      "secret",
    );
  });
  it("old cloud/context/handle APIs fail closed without network access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(
      (
        await prepareAiTransferAction({
          purpose: "forged",
          tasks: [{ id: "fake", title: "forged" }],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await dispatchAiTransferAction(
          "fake",
          { private: "content" },
          { task_1: "victim" },
        )
      ).ok,
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
