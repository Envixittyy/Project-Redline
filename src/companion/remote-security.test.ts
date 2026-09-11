import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { CompanionServer } from "./server";
import { CompanionTicketVerifier, signCompanionTicket, ticketDigest } from "./request-ticket";
import { validateCompanionUrl, validatePrivateCompanionOrigin } from "./network-policy";
const key = "ab".repeat(32), audience = "home.test-tailnet.ts.net", origin = "https://forward.example";
const user = randomUUID(), device = randomUUID();
let daemon: CompanionServer | undefined;
let runtime: http.Server | undefined;
afterEach(async () => { vi.restoreAllMocks(); await daemon?.stop(); daemon = undefined; runtime?.closeAllConnections(); if (runtime) await new Promise<void>(resolve => runtime!.close(() => resolve())); runtime = undefined; });
function ticket(path: string, body: unknown, token: string | null = null, deviceId = device,
  capability: "taskChecklist.propose" | "schoolAssessmentPrediction.propose" = "taskChecklist.propose") {
  return signCompanionTicket(key, { audience: `https://${audience}`, origin, userId: user, deviceId, path,
    capability: path === "/v1/infer" ? capability : "session", bodyDigest: ticketDigest(body), tokenHash: ticketDigest(token) });
}
describe("remote private mesh authentication", () => {
  it("requires mesh identity + Redline ticket + pairing; enforces device, replay, runtime and revocation over real HTTP", async () => {
    let runtimeCalls = 0;
    runtime = http.createServer((req, res) => { req.resume(); runtimeCalls++; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ message: { content: '{"fixture":true}' } })); });
    await new Promise<void>(resolve => runtime!.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(runtime.address() as {port:number}).port}`;
    daemon = new CompanionServer({ port: 0, runtimeEndpoints: { ollama: endpoint }, allowedOrigins: [origin], remote: { origin: `https://${audience}`, userLogin: "owner@example.com", signingKey: key } });
    const running = await daemon.start();
    const base = `http://127.0.0.1:${running.port}`;
    const call = (path: string, body: unknown, auth?: string, signed?: string, login: string | null = "owner@example.com") => fetch(`${base}${path}`, {
      method: path === "/health" ? "GET" : "POST", headers: { Origin: origin, "Content-Type": "application/json", Host: audience,
        ...(login ? { "Tailscale-User-Login": login } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(signed ? { "X-Redline-Ticket": signed } : {}) },
      ...(path !== "/health" ? { body: JSON.stringify(body) } : {}),
    });
    expect((await call("/health", null, undefined, ticket("/health", null), null)).status).toBe(403); // Funnel/no identity
    expect((await call("/health", null, undefined, ticket("/health", null), "other@example.com")).status).toBe(403);
    expect((await call("/health", null)).status).toBe(401);
    const preflight = (requestOrigin: string) => fetch(`${base}/v1/infer`, { method: "OPTIONS", headers: {
      Host: audience, Origin: requestOrigin, "Tailscale-User-Login": "owner@example.com",
      "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,x-redline-ticket",
    } });
    const allowed = await preflight(origin);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect((await preflight("https://evil.example")).status).toBe(403);
    const body = { pairingSecret: running.pairingSecret }, pairTicket = ticket("/pair", body);
    const paired = await (await call("/pair", body, undefined, pairTicket)).json();
    expect(paired.ok).toBe(true);
    expect((await call("/pair", body, undefined, pairTicket)).status).toBe(401);
    const request = { provider: "ollama", endpoint: "http://192.168.1.1", request: { model: "test", prompt: "x" } };
    expect((await call("/v1/infer", request, paired.token, ticket("/v1/infer", request, paired.token))).status).toBe(400);
    const valid = { ...request, endpoint };
    const signedInference = ticket("/v1/infer", valid, paired.token);
    const completed = await (await call("/v1/infer", valid, paired.token, signedInference)).json();
    expect(completed.ok).toBe(true);
    expect(completed.content).toBe('{"fixture":true}');
    expect(runtimeCalls).toBe(1);
    expect((await call("/v1/infer", valid, paired.token, signedInference)).status).toBe(401);
    expect(runtimeCalls).toBe(1);
    expect((await call("/unpair", {}, paired.token, ticket("/unpair", {}, paired.token, randomUUID()))).status).toBe(401);
    expect((await call("/unpair", {}, paired.token, ticket("/unpair", {}, paired.token))).status).toBe(200);
    expect((await call("/unpair", {}, paired.token, ticket("/unpair", {}, paired.token))).status).toBe(401);
    expect((await call("/v1/infer", valid, paired.token, ticket("/v1/infer", valid, paired.token))).status).toBe(401);
    expect(runtimeCalls).toBe(1);
  });
  it("tickets bind owner/device, origin, audience, body, token, route, capability and expiry", () => {
    const verifier = () => new CompanionTicketVerifier(key, `https://${audience}`);
    const raw = ticket("/pair", { pairingSecret: "a" });
    expect(() => verifier().verify(raw, origin, "/pair", { pairingSecret: "b" })).toThrow();
    expect(() => verifier().verify(raw, "https://evil.example", "/pair", { pairingSecret: "a" })).toThrow();
    expect(() => verifier().verify(raw, origin, "/v1/infer", { pairingSecret: "a" })).toThrow();
    expect(() => new CompanionTicketVerifier(key, "https://other.net").verify(raw, origin, "/pair", { pairingSecret: "a" })).toThrow();
    expect(() => verifier().verify(raw.slice(0, -2) + "00", origin, "/pair", { pairingSecret: "a" })).toThrow();
    const v = verifier(); v.verify(raw, origin, "/pair", { pairingSecret: "a" });
    expect(() => v.verify(raw, origin, "/pair", { pairingSecret: "a" })).toThrow();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    expect(() => verifier().verify(raw, origin, "/pair", { pairingSecret: "a" })).toThrow();
  });
  it("accepts the reviewed local prediction capability but still binds its exact body", () => {
    const body = { provider: "ollama", endpoint: "http://127.0.0.1:11434", request: { model: "fixture", prompt: "bounded" } };
    const raw = ticket("/v1/infer", body, null, device, "schoolAssessmentPrediction.propose");
    expect(() => new CompanionTicketVerifier(key, `https://${audience}`).verify(raw, origin, "/v1/infer", body)).not.toThrow();
    expect(() => new CompanionTicketVerifier(key, `https://${audience}`).verify(raw, origin, "/v1/infer", { ...body, request: { model: "fixture", prompt: "changed" } })).toThrow();
  });
  it.each(["https://evil.example", "http://home.tail.ts.net", "https://home.tail.ts.net/path", "https://user@home.tail.ts.net", "https://home.tail.ts.net:444", "https://home.tail.ts.net?x=1", "http://100.64.1.1:41400", "https://home.tail.ts.net.evil.net"])("rejects arbitrary targets %s", url => {
    expect(() => validatePrivateCompanionOrigin(url)).toThrow();
    expect(() => validateCompanionUrl(url)).toThrow();
  });
  it("still refuses public or LAN binding in remote mode", async () => {
    daemon = new CompanionServer({ remote: { origin: `https://${audience}`, userLogin: "owner@example.com", signingKey: key } });
    expect(() => daemon!.start(41401, "0.0.0.0")).toThrow();
    expect(() => daemon!.start(41401, "192.168.1.1")).toThrow();
  });
});
