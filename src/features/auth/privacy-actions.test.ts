import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearSensitivePwaState, signInAction, signOutAction } = vi.hoisted(() => ({
  clearSensitivePwaState: vi.fn().mockResolvedValue(undefined),
  signInAction: vi.fn().mockResolvedValue({ status: "idle" }),
  signOutAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

vi.mock("@/lib/offline/pwa-privacy", () => ({ clearSensitivePwaState }));
vi.mock("./auth-actions", () => ({ signInAction, signOutAction }));

import {
  privacySafeSignInAction,
  privacySafeSignOutAction,
} from "./privacy-actions";

describe("privacy-safe authentication actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears previous account state before a sign-in attempt", async () => {
    const formData = new FormData();
    await privacySafeSignInAction({ status: "idle" }, formData);

    expect(clearSensitivePwaState).toHaveBeenCalledOnce();
    expect(signInAction).toHaveBeenCalledWith({ status: "idle" }, formData);
    expect(clearSensitivePwaState.mock.invocationCallOrder[0]).toBeLessThan(
      signInAction.mock.invocationCallOrder[0],
    );
  });

  it("clears private caches and queued mutations before sign-out", async () => {
    await privacySafeSignOutAction({ status: "idle" });

    expect(clearSensitivePwaState).toHaveBeenCalledOnce();
    expect(signOutAction).toHaveBeenCalledWith({ status: "idle" });
    expect(clearSensitivePwaState.mock.invocationCallOrder[0]).toBeLessThan(
      signOutAction.mock.invocationCallOrder[0],
    );
  });
});
