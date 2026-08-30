import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkCompanionHealth,
  pairCompanion,
  inferLocalContent,
} from "./companion-client";
const config = {
  enabled: true,
  companionUrl: "http://127.0.0.1:41400",
  provider: "ollama" as const,
  endpoint: "http://127.0.0.1:11434",
  model: "test",
  pairingToken: `fwd_comp_${"a".repeat(64)}`,
};
describe("Browser-to-loopback transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("never sends server-side requests to the host server localhost", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await checkCompanionHealth()).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects LAN/WAN/credentials/alternate ports before fetch", async () => {
    vi.stubGlobal("window", {});
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const target of [
      "http://10.0.0.1:41400",
      "https://example.com",
      "http://user:secret@127.0.0.1:41400",
      "http://127.0.0.1:8080",
    ])
      expect((await pairCompanion(target, "secret")).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses CORS, no cookies, refuses redirects and requests loopback permission", async () => {
    vi.stubGlobal("window", {});
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, content: "untrusted" })),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await inferLocalContent(config, { model: "test", prompt: "data" }),
    ).toBe("untrusted");
    expect(fetch.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:41400/v1/infer",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      mode: "cors",
      targetAddressSpace: "loopback",
      cache: "no-store",
    });
  });
  it("does not echo runtime error bodies or retry ambiguous failures", async () => {
    vi.stubGlobal("window", {});
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("private prompt and secrets", { status: 502 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      inferLocalContent(config, { model: "test", prompt: "data" }),
    ).rejects.toThrow("Companion request failed.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized response bodies", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(100000))),
    );
    await expect(
      inferLocalContent(config, { model: "test", prompt: "data" }),
    ).rejects.toThrow(/size/);
  });
});
