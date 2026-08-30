import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OllamaAdapter } from "./ollama-adapter";
import { LlamaCppAdapter } from "./llamacpp-adapter";
import { OpenAiCompatibleAdapter } from "./openai-compatible-adapter";
import { readBoundedResponseText } from "./runtime-adapter";
let server: http.Server,
  endpoint: string,
  mode = "redirect",
  sinkHits = 0;
describe("Runtime adversarial network responses", () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      if (req.url === "/sink") {
        sinkHits++;
        res.end("secret");
        return;
      }
      if (mode === "redirect") {
        res.writeHead(302, { Location: `${endpoint}/sink` });
        res.end();
        return;
      }
      if (mode === "oversized") {
        res.end("x".repeat(1024 * 1024 + 1));
        return;
      }
      if (mode === "invalid") {
        res.end(
          JSON.stringify({
            message: { content: { tool: "shell" } },
            choices: [{ message: { content: 42 } }],
          }),
        );
        return;
      }
      if (mode === "error") {
        res.writeHead(500);
        res.end("private prompt and bearer secret");
        return;
      }
      // timeout mode deliberately leaves the response pending until client abort.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    endpoint = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  for (const adapter of [
    new OllamaAdapter(),
    new LlamaCppAdapter(),
    new OpenAiCompatibleAdapter(),
  ]) {
    it(`${adapter.id}: refuses redirects and never follows the destination`, async () => {
      mode = "redirect";
      sinkHits = 0;
      expect(
        (await adapter.infer(endpoint, { model: "test", prompt: "data" })).ok,
      ).toBe(false);
      expect(sinkHits).toBe(0);
    });
    it(`${adapter.id}: discovery fails closed on redirects, oversized, or malformed responses`, async () => {
      sinkHits = 0;
      for (const m of ["redirect", "oversized", "invalid"]) {
        mode = m;
        expect((await adapter.checkHealth(endpoint)).ok).toBe(false);
      }
      expect(sinkHits).toBe(0);
    });
    it(`${adapter.id}: bounds bytes and validates response content type`, async () => {
      for (const m of ["oversized", "invalid"]) {
        mode = m;
        expect(
          (await adapter.infer(endpoint, { model: "test", prompt: "data" })).ok,
        ).toBe(false);
      }
    });
    it(`${adapter.id}: does not return private error bodies`, async () => {
      mode = "error";
      const result = await adapter.infer(endpoint, {
        model: "test",
        prompt: "data",
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private prompt");
    });
    it(`${adapter.id}: respects cancellation even when a caller supplies its own signal`, async () => {
      mode = "timeout";
      expect(
        (
          await adapter.infer(
            endpoint,
            { model: "test", prompt: "data" },
            AbortSignal.timeout(20),
          )
        ).ok,
      ).toBe(false);
    });
    it(`${adapter.id}: refuses unsafe root paths before making requests`, async () => {
      expect(
        (
          await adapter.infer(endpoint + "/admin", {
            model: "test",
            prompt: "data",
          })
        ).ok,
      ).toBe(false);
    });
  }
  it("bounds streamed bytes even without Content-Length", async () => {
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(100));
          c.enqueue(new Uint8Array(100));
          c.close();
        },
      }),
    );
    await expect(readBoundedResponseText(response, 150)).rejects.toThrow(
      /size/,
    );
  });
});
