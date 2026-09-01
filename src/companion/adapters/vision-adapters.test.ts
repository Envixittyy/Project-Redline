import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalInferenceRequest } from "../types";
import { LlamaCppAdapter } from "./llamacpp-adapter";
import { OllamaAdapter } from "./ollama-adapter";
import { OpenAiCompatibleAdapter } from "./openai-compatible-adapter";

const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const base64 = bytes.toString("base64");
const digest = createHash("sha256").update(bytes).digest("hex");
const request: LocalInferenceRequest = {
  model: "vision-fixture",
  prompt: "Read only the disclosed normalized image.",
  media: [{ type: "image", mimeType: "image/png", base64, digest }],
};
const fetchMock = vi.fn<typeof fetch>();

describe("local adapter normalized-image transport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the exact normalized bytes in Ollama's image field", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: { role: "assistant", content: "ok" } }));
    expect((await new OllamaAdapter().infer("http://127.0.0.1:11434", request)).ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: request.prompt, images: [base64] });
    expect(JSON.stringify(body)).not.toContain("http://");
  });

  it("constructs an internal OpenAI data URL from the exact bytes", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }));
    expect((await new OpenAiCompatibleAdapter().infer("http://127.0.0.1:1234/v1", request)).ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages.at(-1).content).toEqual([
      { type: "text", text: request.prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${base64}`, detail: "auto" } },
    ]);
  });

  it("fails closed for llama.cpp and performs no runtime request", async () => {
    const result = await new LlamaCppAdapter().infer("http://127.0.0.1:8080", request);
    expect(result).toMatchObject({ ok: false, error: "unsupported_modality", failureCode: "unsupported_modality" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...request, media: [{ ...request.media![0], digest: "0".repeat(64) }] },
    { ...request, media: [{ ...request.media![0], base64: "https://attacker.invalid/image.png" }] },
    { ...request, images: ["https://attacker.invalid/image.png"], media: undefined },
  ])("rejects substitution, URL-like input and legacy input before transport", async invalid => {
    const result = await new OllamaAdapter().infer("http://127.0.0.1:11434", invalid as LocalInferenceRequest);
    expect(result).toMatchObject({ ok: false, failureCode: "unsupported_modality" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
