import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LlamaCppAdapter } from "./llamacpp-adapter";
import { OllamaAdapter } from "./ollama-adapter";
import { OpenAiCompatibleAdapter } from "./openai-compatible-adapter";

describe("Local Runtime Adapters", () => {
  let mockServer: http.Server;
  let mockEndpoint: string;

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      // Ollama mock endpoints
      if (url.pathname === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            models: [
              { name: "qwen2.5:7b", model: "qwen2.5:7b", details: { parameter_size: "7B" } },
              { name: "llama3.2:3b", model: "llama3.2:3b" },
            ],
          }),
        );
        return;
      }

      if (url.pathname === "/api/chat") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}");
          if (parsed.model === "missing-model") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("model not found");
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              message: {
                role: "assistant",
                content: JSON.stringify({
                  schema_version: 1,
                  actions: [
                    {
                      type: "create_task",
                      title: "Complete lab report",
                      priority: "high",
                      confidence: 0.95,
                    },
                  ],
                }),
              },
              prompt_eval_count: 15,
              eval_count: 30,
            }),
          );
        });
        return;
      }

      // llama.cpp mock endpoints
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // OpenAI-compatible / llama.cpp models
      if (url.pathname === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "qwen2.5-7b-instruct", name: "Qwen 2.5 7B Instruct" }],
          }),
        );
        return;
      }

      // OpenAI-compatible / llama.cpp chat completions
      if (url.pathname === "/v1/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    schema_version: 1,
                    actions: [
                      {
                        type: "create_note",
                        title: "Lecture Notes Week 1",
                        confidence: 0.9,
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address();
        const port = typeof addr === "object" && addr ? addr.port : 8080;
        mockEndpoint = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  describe("OllamaAdapter", () => {
    const adapter = new OllamaAdapter();

    it("checks health and lists models successfully", async () => {
      const health = await adapter.checkHealth(mockEndpoint);
      expect(health.ok).toBe(true);
      expect(health.models.length).toBe(2);
      expect(health.models[0].name).toBe("qwen2.5:7b");
    });

    it("executes structured JSON inference", async () => {
      const res = await adapter.infer(mockEndpoint, {
        model: "qwen2.5:7b",
        prompt: "Create a task for lab report",
        formatJson: true,
      });

      expect(res.ok).toBe(true);
      expect(res.content).toContain("Complete lab report");
      expect(res.usage?.totalTokens).toBe(45);
    });

    it("normalizes missing model errors", async () => {
      const res = await adapter.infer(mockEndpoint, {
        model: "missing-model",
        prompt: "Hello",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain("Ollama model \"missing-model\" not found");
    });

    it("normalizes offline runtime errors gracefully", async () => {
      const health = await adapter.checkHealth("http://127.0.0.1:59999");
      expect(health.ok).toBe(false);
      expect(health.error).toContain("Runtime offline");
    });
  });

  describe("LlamaCppAdapter", () => {
    const adapter = new LlamaCppAdapter();

    it("checks health and lists loaded models", async () => {
      const health = await adapter.checkHealth(mockEndpoint);
      expect(health.ok).toBe(true);
      expect(health.models.length).toBeGreaterThan(0);
    });

    it("executes chat completions inference", async () => {
      const res = await adapter.infer(mockEndpoint, {
        model: "qwen2.5-7b-instruct",
        prompt: "Take lecture notes",
        formatJson: true,
      });

      expect(res.ok).toBe(true);
      expect(res.content).toContain("Lecture Notes Week 1");
    });
  });

  describe("OpenAiCompatibleAdapter", () => {
    const adapter = new OpenAiCompatibleAdapter();

    it("checks health and lists models from /v1/models", async () => {
      const health = await adapter.checkHealth(mockEndpoint);
      expect(health.ok).toBe(true);
      expect(health.models[0].id).toBe("qwen2.5-7b-instruct");
    });

    it("executes inference with response_format json_object", async () => {
      const res = await adapter.infer(mockEndpoint, {
        model: "qwen2.5-7b-instruct",
        prompt: "Create a note",
        formatJson: true,
      });

      expect(res.ok).toBe(true);
      expect(res.content).toContain("Lecture Notes Week 1");
    });
  });
});

