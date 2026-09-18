import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkStorageDurability,
  requestStoragePersistence,
} from "./storage-durability";

describe("Storage Durability Helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unsupported state when navigator.storage is undefined", async () => {
    vi.stubGlobal("navigator", {});

    const status = await checkStorageDurability();
    expect(status).toEqual({
      isSupported: false,
      isPersisted: false,
      canRequest: false,
    });

    const result = await requestStoragePersistence();
    expect(result).toEqual({
      supported: false,
      granted: false,
    });
  });

  it("detects when storage is already persisted", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn().mockResolvedValue(true),
        persist: vi.fn().mockResolvedValue(true),
      },
    });

    const status = await checkStorageDurability();
    expect(status).toEqual({
      isSupported: true,
      isPersisted: true,
      canRequest: false,
    });
  });

  it("detects when storage is supported but not yet persisted (canRequest: true)", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(true),
      },
    });

    const status = await checkStorageDurability();
    expect(status).toEqual({
      isSupported: true,
      isPersisted: false,
      canRequest: true,
    });
  });

  it("handles persist request granted by browser", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(true),
      },
    });

    const result = await requestStoragePersistence();
    expect(result).toEqual({
      supported: true,
      granted: true,
    });
  });

  it("handles persist request denied by browser", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(false),
      },
    });

    const result = await requestStoragePersistence();
    expect(result).toEqual({
      supported: true,
      granted: false,
    });
  });

  it("handles unexpected errors in persisted() or persist() gracefully", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn().mockRejectedValue(new Error("SecurityError")),
        persist: vi.fn().mockRejectedValue(new Error("SecurityError")),
      },
    });

    const status = await checkStorageDurability();
    expect(status).toEqual({
      isSupported: false,
      isPersisted: false,
      canRequest: false,
    });

    const result = await requestStoragePersistence();
    expect(result).toEqual({
      supported: true,
      granted: false,
    });
  });
});
