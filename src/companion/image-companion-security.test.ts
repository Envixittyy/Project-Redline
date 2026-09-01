import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LocalInferenceRequest } from "./types";
import { signCompanionTicket, ticketDigest, type CompanionCapability } from "./request-ticket";
import { CompanionServer } from "./server";

const origin = "https://redline.example";
const audience = "http://127.0.0.1:41400";
const key = "ab".repeat(32);
const userId = randomUUID();
const deviceId = randomUUID();
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const media = [{
  type: "image" as const,
  mimeType: "image/png" as const,
  base64: bytes.toString("base64"),
  digest: createHash("sha256").update(bytes).digest("hex"),
}];

describe("same-PC image Companion authorization", () => {
  let server: CompanionServer;
  let base: string;
  let token: string;
  const infer = vi.fn(async (_endpoint: string, request: LocalInferenceRequest) => ({
    ok: true, content: request.media?.[0].digest ?? "missing", model: request.model, provider: "ollama" as const,
  }));

  function call(body: unknown, ticket?: string) {
    return fetch(`${base}/v1/infer`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        ...(ticket ? { "X-Redline-Ticket": ticket } : {}) },
      body: JSON.stringify(body),
    });
  }
  function sign(body: unknown, capability: CompanionCapability = "schoolScheduleImage.propose") {
    return signCompanionTicket(key, { audience, origin, userId, deviceId, path: "/v1/infer", capability,
      bodyDigest: ticketDigest(body), tokenHash: ticketDigest(token) });
  }

  beforeAll(async () => {
    server = new CompanionServer({ port: 0, pairingSecret: "fixture", allowedOrigins: [origin], imageTrust: { audience, signingKey: key } });
    server.adapters.ollama.infer = infer;
    const running = await server.start();
    base = `http://127.0.0.1:${running.port}`;
    const paired = await fetch(`${base}/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ pairingSecret: "fixture" }) });
    token = (await paired.json()).token;
  });
  afterAll(async () => server.stop());

  it("requires a single-use exact-body image ticket and passes only the disclosed bytes", async () => {
    const body = { provider: "ollama", request: { model: "vision-fixture", prompt: "bounded", media } };
    expect((await call(body)).status).toBe(400);
    expect(infer).not.toHaveBeenCalled();

    const browserClaim = { ...body, request: { ...body.request, supportsVision: true } };
    expect((await call(browserClaim, sign(browserClaim))).status).toBe(400);
    expect(infer).not.toHaveBeenCalled();

    const ticket = sign(body);
    expect((await call({ ...body, request: { ...body.request, media: [{ ...media[0], digest: "0".repeat(64) }] } }, ticket)).status).toBe(400);
    expect(infer).not.toHaveBeenCalled();

    const result = await call(body, ticket);
    expect(result.status).toBe(200);
    expect(infer).toHaveBeenCalledTimes(1);
    expect(infer.mock.calls[0][1].media).toEqual(media);
    expect((await call(body, ticket)).status).toBe(400);
    expect(infer).toHaveBeenCalledTimes(1);
  });

  it("rejects text-capability tickets for media and image-capability tickets for text", async () => {
    const imageBody = { provider: "ollama", request: { model: "vision-fixture", prompt: "bounded", media } };
    expect((await call(imageBody, sign(imageBody, "taskChecklist.propose"))).status).toBe(400);
    const textBody = { provider: "ollama", request: { model: "vision-fixture", prompt: "bounded" } };
    expect((await call(textBody, sign(textBody, "blackboardCourseImage.propose"))).status).toBe(400);
    expect(infer).toHaveBeenCalledTimes(1);
  });
});
