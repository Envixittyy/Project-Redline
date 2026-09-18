import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearOfflineMutations } = vi.hoisted(() => ({
  clearOfflineMutations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./queue", () => ({ clearOfflineMutations }));

import {
  clearSensitivePwaState,
  clearUnsafePwaCaches,
} from "./pwa-privacy";

describe("PWA auth-boundary cleanup", () => {
  const cacheDelete = vi.fn().mockResolvedValue(true);
  const removePreference = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("caches", {
      keys: vi
        .fn()
        .mockResolvedValue([
          "life-os-shell-v1",
          "redline-static-v1",
          "redline-static-v2",
          "other-app-cache",
        ]),
      delete: cacheDelete,
    });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("localStorage", { removeItem: removePreference });
  });

  it("deletes legacy unsafe caches but keeps current static and unrelated caches", async () => {
    await clearUnsafePwaCaches();

    expect(cacheDelete).toHaveBeenCalledWith("life-os-shell-v1");
    expect(cacheDelete).toHaveBeenCalledWith("redline-static-v1");
    expect(cacheDelete).not.toHaveBeenCalledWith("redline-static-v2");
    expect(cacheDelete).not.toHaveBeenCalledWith("other-app-cache");
  });

  it("clears account-sensitive offline mutations without touching preferences", async () => {
    await clearSensitivePwaState();

    expect(clearOfflineMutations).toHaveBeenCalledOnce();
    expect(removePreference).not.toHaveBeenCalled();
  });

  it("preserves browser-local PrivateStore during sign-out cleanup", async () => {
    const idbDeleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase: idbDeleteDatabase });

    await clearSensitivePwaState();

    // Verify indexedDB.deleteDatabase is NEVER called on PrivateStore
    expect(idbDeleteDatabase).not.toHaveBeenCalledWith("redline-private-store-v1");
  });
});
