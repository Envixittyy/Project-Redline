import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CompanionTokenManager,
  isLoopbackHost,
  redactSensitiveInfo,
  validateLoopbackUrl,
  validateOrigin,
} from "./security";
import { CompanionServer } from "./server";

describe("Companion Security & Loopback Policies", () => {
  it("strictly identifies loopback hostnames and rejects remote/LAN addresses", () => {
    // Allowed loopback hosts
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.0.0.2")).toBe(true);
    expect(isLoopbackHost("127.1.2.3")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(true);
    expect(isLoopbackHost("localhost:8080")).toBe(true);
    expect(isLoopbackHost("127.0.0.1:11434")).toBe(true);

    // Forbidden remote, private LAN, and public WAN hosts
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("172.16.0.1")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("api.openai.com")).toBe(false);
    expect(isLoopbackHost("8.8.8.8")).toBe(false);
  });

  it("validates loopback URLs and rejects non-loopback URLs", () => {
    expect(() => validateLoopbackUrl("http://127.0.0.1:11434")).not.toThrow();
    expect(() => validateLoopbackUrl("http://localhost:8080")).not.toThrow();
    expect(() => validateLoopbackUrl("http://127.0.0.1:1234/v1")).not.toThrow();

    expect(() => validateLoopbackUrl("http://192.168.1.50:11434")).toThrow(
      /Security violation.*not a local loopback address/,
    );
    expect(() => validateLoopbackUrl("http://example.com/api")).toThrow(
      /Security violation.*not a local loopback address/,
    );
    expect(() => validateLoopbackUrl("ftp://localhost:8080")).toThrow(
      /Invalid protocol/,
    );
  });

  it("validates allowed origins", () => {
    expect(validateOrigin("http://localhost:3000")).toBe(true);
    expect(validateOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(validateOrigin("https://malicious-site.com")).toBe(false);
    expect(validateOrigin(undefined)).toBe(false);
  });

  it("manages pairing tokens and enforces expiration/revocation", () => {
    const manager = new CompanionTokenManager("test-secret-123", 1000); // 1s TTL

    // Invalid secret
    const failPair = manager.pair("wrong-secret", "http://localhost:3000");
    expect(failPair.ok).toBe(false);

    // Valid secret
    const pairRes = manager.pair("test-secret-123", "http://localhost:3000");
    expect(pairRes.ok).toBe(true);
    if (!pairRes.ok) return;

    const token = pairRes.token;
    expect(token).toMatch(/^fwd_comp_/);
    expect(manager.verify(token)).toBe(true);

    // Revocation
    manager.revoke(token);
    expect(manager.verify(token)).toBe(false);
  });

  it("redacts sensitive secrets, tokens, and authorization headers from logs", () => {
    const log = `Received Bearer fwd_comp_abc123456789 with {"pairingSecret":"supersecret","token":"fwd_comp_xyz987"}`;
    const redacted = redactSensitiveInfo(log);

    expect(redacted).not.toContain("abc123456789");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("xyz987");
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).toContain('"pairingSecret":"[REDACTED]"');
  });
});

describe("CompanionServer HTTP API Integration", () => {
  let server: CompanionServer;
  let companionUrl: string;
  const pairingSecret = "test-secret-suite-123";

  beforeAll(async () => {
    server = new CompanionServer({
      port: 0, // dynamic port
      host: "127.0.0.1",
      pairingSecret,
      silent: true,
    });
    const info = await server.start();
    companionUrl = `http://127.0.0.1:${info.port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("responds to unauthenticated GET /health", async () => {
    const res = await fetch(`${companionUrl}/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; companion: string; version: string };
    expect(data.ok).toBe(true);
    expect(data.companion).toBe("running");
  });

  it("rejects unauthorized access to /v1/status without token", async () => {
    const res = await fetch(`${companionUrl}/v1/status`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests from disallowed origins", async () => {
    const res = await fetch(`${companionUrl}/health`, {
      headers: { Origin: "http://malicious-external-site.com" },
    });
    expect(res.status).toBe(403);
  });

  it("pairs successfully with pairing secret and allows authenticated requests", async () => {
    // 1. Pair
    const pairRes = await fetch(`${companionUrl}/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        pairingSecret,
        clientOrigin: "http://localhost:3000",
      }),
    });

    expect(pairRes.status).toBe(200);
    const pairData = (await pairRes.json()) as { ok: boolean; token: string };
    expect(pairData.ok).toBe(true);
    expect(pairData.token).toBeTruthy();

    const token = pairData.token;

    // 2. Authenticated request
    const statusRes = await fetch(`${companionUrl}/v1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        provider: "ollama",
        endpoint: "http://127.0.0.1:11434",
      }),
    });

    expect(statusRes.status).toBe(200);
    const statusData = (await statusRes.json()) as { paired: boolean; provider: string };
    expect(statusData.paired).toBe(true);
    expect(statusData.provider).toBe("ollama");

    // 3. Unpair
    const unpairRes = await fetch(`${companionUrl}/unpair`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Authorization: `Bearer ${token}`,
      },
    });
    expect(unpairRes.status).toBe(200);

    // 4. Request with revoked token fails
    const statusAfterUnpair = await fetch(`${companionUrl}/v1/status`, {
      headers: {
        Origin: "http://localhost:3000",
        Authorization: `Bearer ${token}`,
      },
    });
    expect(statusAfterUnpair.status).toBe(401);
  });
});
