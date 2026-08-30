import { request as httpRequest } from "node:http";
import {
  afterEach,
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CompanionTokenManager,
  isLoopbackHost,
  redactSensitiveInfo,
  validateLoopbackUrl,
  validateOrigin,
} from "./security";
import { CompanionServer } from "./server";

const origin = "https://redline.example";
describe("Companion network and pairing policy", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    "0.0.0.0",
    "127.0.0.2",
    "127.0.0.1:80",
    "[::1]:80",
    "192.168.1.1",
    "169.254.169.254",
    "example.com",
  ])("rejects host %s", (host) => expect(isLoopbackHost(host)).toBe(false));
  it.each([
    "http://0.0.0.0:11434",
    "http://192.168.1.1:80",
    "https://example.com",
    "http://user:pass@localhost:80",
    "http://localhost:80/?token=secret",
    "http://localhost:80/admin",
    "file:///etc/passwd",
  ])("rejects target %s", (url) =>
    expect(() => validateLoopbackUrl(url)).toThrow(),
  );
  it("pins localhost and strictly matches origins", () => {
    expect(validateLoopbackUrl("http://localhost:1234/v1").hostname).toBe(
      "127.0.0.1",
    );
    expect(validateOrigin(origin, [origin])).toBe(true);
    for (const bad of [
      undefined,
      "null",
      `${origin}/`,
      `${origin}.evil`,
      "HTTPS://REDLINE.EXAMPLE",
    ])
      expect(validateOrigin(bad, [origin])).toBe(false);
  });
  it("expires pairing codes and tokens; binds origin; re-pair revokes old token", () => {
    vi.useFakeTimers();
    const manager = new CompanionTokenManager("fixture", 1000, 2000);
    expect(manager.pair("wrong", origin).ok).toBe(false);
    const first = manager.pair("fixture", origin);
    if (!first.ok) throw new Error();
    expect(manager.verify(first.token, origin)).toBe(true);
    expect(manager.verify(first.token, "https://other.example")).toBe(false);
    expect(manager.verify(first.token)).toBe(false);
    const second = manager.pair("fixture", origin);
    if (!second.ok) throw new Error();
    expect(manager.verify(first.token, origin)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(manager.verify(second.token, origin)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(manager.pair("fixture", origin).ok).toBe(false);
  });
  it("redacts bearer and pairing secrets", () => {
    const value = redactSensitiveInfo(
      'Bearer fwd_comp_secret {"pairingSecret":"private","token":"secret"}',
    );
    expect(value).not.toContain("private");
    expect(value).not.toContain("fwd_comp_secret");
  });
  it("rejects broad bind addresses and malformed allowed origins", () => {
    expect(() => new CompanionServer({ host: "0.0.0.0" }).start()).toThrow();
    expect(() => new CompanionServer({ allowedOrigins: ["*"] })).toThrow();
    expect(
      () =>
        new CompanionServer({
          runtimeEndpoints: { ollama: "http://10.0.0.1" },
        }),
    ).toThrow();
  });
});

describe("Companion HTTP trust boundary", () => {
  let server: CompanionServer, base: string, token: string;
  const infer = vi.fn(async () => ({
    ok: true,
    content: '{"untrusted":"output"}',
    model: "test",
    provider: "ollama" as const,
  }));
  const health = vi.fn(async () => ({
    ok: true,
    provider: "ollama" as const,
    endpoint: "http://127.0.0.1:11434/",
    models: [],
  }));
  function send(
    path: string,
    body: unknown = {},
    bearer = token,
    extra: Record<string, string> = {},
  ) {
    return fetch(base + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    });
  }
  beforeAll(async () => {
    server = new CompanionServer({
      port: 0,
      pairingSecret: "fixture",
      allowedOrigins: [origin, "https://other.example"],
    });
    server.adapters.ollama.infer = infer;
    server.adapters.ollama.checkHealth = health;
    const info = await server.start();
    base = `http://127.0.0.1:${info.port}`;
    const pair = await send("/pair", { pairingSecret: "fixture" }, "");
    token = (await pair.json()).token;
  });
  afterAll(async () => {
    await server.stop();
  });
  it("health works with an allowed hosted origin and originless CLI", async () => {
    expect(
      (await fetch(base + "/health", { headers: { Origin: origin } })).status,
    ).toBe(200);
    expect((await fetch(base + "/health")).status).toBe(200);
  });
  it("rejects originless pair, untrusted origin, invalid bearer and Host rebinding", async () => {
    expect((await fetch(base + "/pair", { method: "POST" })).status).toBe(403);
    expect(
      (await send("/v1/status", {}, token, { Origin: "https://evil.example" }))
        .status,
    ).toBe(403);
    expect((await send("/v1/status", {}, "bad")).status).toBe(401);
    expect(
      (await send("/v1/status", {}, token, { Origin: "https://other.example" }))
        .status,
    ).toBe(401);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        base + "/health",
        { headers: { Host: "evil.example", Origin: origin } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
  it("preflight permits only the exact method, headers and route", async () => {
    const request = {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    };
    const res = await fetch(base + "/v1/infer", request);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Private-Network")).toBe(
      "true",
    );
    expect((await fetch(base + "/proxy", request)).status).toBe(404);
    expect(
      (
        await fetch(base + "/v1/infer", {
          ...request,
          headers: {
            ...request.headers,
            "Access-Control-Request-Headers": "cookie",
          },
        })
      ).status,
    ).toBe(403);
  });
  it("malformed, unknown, oversized and browser-selected targets never reach adapters", async () => {
    const before = infer.mock.calls.length;
    for (const body of [
      null,
      [],
      { provider: "__proto__" },
      {
        provider: "ollama",
        endpoint: "http://127.0.0.1:9999",
        request: { model: "test", prompt: "x" },
      },
      { provider: "ollama", endpoint: "http://192.168.1.1", request: {} },
      {
        provider: "ollama",
        request: { model: "test", prompt: "x", tools: ["shell"] },
      },
      {
        provider: "ollama",
        request: { model: "test", prompt: "x".repeat(65537) },
      },
    ])
      expect((await send("/v1/infer", body)).status).toBe(400);
    expect(infer.mock.calls.length).toBe(before);
    expect((await send("/unknown")).status).toBe(404);
    expect((await send("/v1/infer?endpoint=evil")).status).toBe(404);
    await expect(
      send("/v1/infer", { data: "x".repeat(100000) })
        .then((r) => r.status)
        .catch(() => 400),
    ).resolves.toBe(400);
  });
  it("sends only the fixed narrow inference request and supports runtime status", async () => {
    expect((await send("/v1/status", { provider: "ollama" })).status).toBe(200);
    const res = await send("/v1/infer", {
      provider: "ollama",
      request: { model: "test", prompt: "untrusted data" },
    });
    expect(res.status).toBe(200);
    expect(infer).toHaveBeenCalled();
  });
  it("unpair revokes access and deliberate re-pair reconnects", async () => {
    expect((await send("/unpair")).status).toBe(200);
    expect((await send("/v1/status", { provider: "ollama" })).status).toBe(401);
    const pair = await send("/pair", { pairingSecret: "fixture" }, "");
    token = (await pair.json()).token;
    expect((await send("/v1/status", { provider: "ollama" })).status).toBe(200);
  });
});
