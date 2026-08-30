import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerListener = (event: Record<string, unknown>) => void;

function loadWorker() {
  const listeners = new Map<string, WorkerListener>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const context = {
    URL,
    Promise,
    fetch: vi.fn(),
    caches: {
      open: vi.fn().mockResolvedValue({ addAll: vi.fn(), put: vi.fn() }),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
      match: vi.fn(),
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    },
    self: {
      location: { origin: "https://forward.example" },
      registration: { showNotification },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (type: string, listener: WorkerListener) => {
        listeners.set(type, listener);
      },
    },
  };

  const source = readFileSync("public/sw.js", "utf8");
  vm.runInNewContext(source, context);
  return { listeners, showNotification, openWindow };
}

describe("service worker notification navigation", () => {
  it("falls back to a generic notification for malformed push JSON", async () => {
    const { listeners, showNotification } = loadWorker();
    let pending: Promise<unknown> | undefined;

    listeners.get("push")?.({
      data: {
        json: () => {
          throw new SyntaxError("malformed");
        },
      },
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;

    expect(showNotification).toHaveBeenCalledWith(
      "Forward",
      expect.objectContaining({
        body: "You have an update.",
        data: { url: "/" },
      }),
    );
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "javascript:alert(1)",
  ])("replaces an unsafe push URL with the app root: %s", async (url) => {
    const { listeners, showNotification } = loadWorker();
    let pending: Promise<unknown> | undefined;

    listeners.get("push")?.({
      data: { json: () => ({ title: "Test", body: "Body", url }) },
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;

    expect(showNotification).toHaveBeenCalledWith(
      "Test",
      expect.objectContaining({ data: { url: "/" } }),
    );
  });

  it("opens only a same-origin sanitized notification target", async () => {
    const { listeners, openWindow } = loadWorker();
    let pending: Promise<unknown> | undefined;

    listeners.get("notificationclick")?.({
      notification: {
        close: vi.fn(),
        data: { url: "//attacker.example/steal" },
      },
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;

    expect(openWindow).toHaveBeenCalledWith("https://forward.example/");
  });
});
