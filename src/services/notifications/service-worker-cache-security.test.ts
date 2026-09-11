import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerListener = (event: Record<string, unknown>) => void;

function loadWorker(cacheNames: string[] = []) {
  const listeners = new Map<string, WorkerListener>();
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const cacheStorage = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(cacheNames),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetchMock = vi.fn();
  const context = {
    URL,
    Response,
    Promise,
    fetch: fetchMock,
    caches: cacheStorage,
    clients: {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
    self: {
      location: { origin: "https://forward.example" },
      registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (type: string, listener: WorkerListener) => {
        listeners.set(type, listener);
      },
    },
  };

  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), context);
  return { cache, cacheStorage, fetchMock, listeners };
}

function request(path: string, overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    mode: "same-origin",
    destination: "",
    url: `https://forward.example${path}`,
    ...overrides,
  };
}

describe("service worker cache privacy", () => {
  it("pre-caches only public static assets, never workspace navigation", async () => {
    const { cache, listeners } = loadWorker();
    let pending: Promise<unknown> | undefined;
    listeners.get("install")?.({
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;

    expect(cache.addAll).toHaveBeenCalledWith([
      "/manifest.webmanifest",
      "/favicon.ico",
    ]);
    expect(cache.addAll).not.toHaveBeenCalledWith(
      expect.arrayContaining(["/", "/notes", "/tasks"]),
    );
  });

  it("invalidates legacy Redline caches without deleting unrelated caches", async () => {
    const { cacheStorage, listeners } = loadWorker([
      "life-os-shell-v1",
      "redline-static-v1",
      "redline-static-v2",
      "other-app-cache",
    ]);
    let pending: Promise<unknown> | undefined;
    listeners.get("activate")?.({
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;

    expect(cacheStorage.delete).toHaveBeenCalledWith("life-os-shell-v1");
    expect(cacheStorage.delete).toHaveBeenCalledWith("redline-static-v1");
    expect(cacheStorage.delete).not.toHaveBeenCalledWith("redline-static-v2");
    expect(cacheStorage.delete).not.toHaveBeenCalledWith("other-app-cache");
  });

  it("uses network-only navigation and returns a private-data-free offline response", async () => {
    const { cache, fetchMock, listeners } = loadWorker();
    fetchMock.mockRejectedValue(new TypeError("offline"));
    let responsePromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: request("/notes", { mode: "navigate" }),
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
      waitUntil: vi.fn(),
    });
    const response = await responsePromise;

    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe(
      "You are offline. Sign in again when the network is available.",
    );
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ["authenticated API", "/api/attachments/private-id", "image"],
    ["workspace data request", "/notes/private-preview", "image"],
  ])("does not intercept or cache %s responses", (_label, path, destination) => {
    const { cacheStorage, listeners } = loadWorker();
    const respondWith = vi.fn();
    listeners.get("fetch")?.({
      request: request(path, { destination }),
      respondWith,
      waitUntil: vi.fn(),
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(cacheStorage.open).not.toHaveBeenCalled();
  });

  it("retains cache-first behavior for allowlisted static assets", async () => {
    const { cache, cacheStorage, listeners } = loadWorker();
    const cached = new Response("static");
    cache.match.mockResolvedValue(cached);
    let responsePromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: request("/_next/static/chunks/app.js", {
        destination: "script",
      }),
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
      waitUntil: vi.fn(),
    });

    expect(await responsePromise).toBe(cached);
    expect(cacheStorage.open).toHaveBeenCalledWith("redline-static-v2");
  });
});
