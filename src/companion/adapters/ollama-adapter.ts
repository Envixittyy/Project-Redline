import { validateLoopbackUrl } from "../security";
import type {
  LocalInferenceRequest,
  LocalInferenceResponse,
  LocalModelDescriptor,
  LocalRuntimeCapabilities,
  RuntimeHealthResult,
} from "../types";
import {
  LocalAdapterError,
  normalizeLocalError,
  type LocalRuntimeAdapter,
} from "./runtime-adapter";

export class OllamaAdapter implements LocalRuntimeAdapter {
  readonly id = "ollama" as const;

  getCapabilities(): LocalRuntimeCapabilities {
    return {
      streaming: true,
      jsonFormat: true,
      modelDiscovery: true,
      abortSignal: true,
    };
  }

  async checkHealth(endpoint: string): Promise<RuntimeHealthResult> {
    try {
      const url = validateLoopbackUrl(endpoint);
      const tagsUrl = new URL("/api/tags", url).toString();
      const res = await fetch(tagsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return {
          ok: false,
          provider: this.id,
          endpoint,
          models: [],
          error: `Ollama returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { models?: Array<{ name: string; model?: string; details?: Record<string, unknown> }> };
      const models: LocalModelDescriptor[] = (data.models || []).map((m) => ({
        id: m.model || m.name,
        name: m.name,
        provider: this.id,
        details: m.details,
      }));

      return {
        ok: true,
        provider: this.id,
        endpoint,
        models,
      };
    } catch (err) {
      const normalized = normalizeLocalError(err, this.id);
      return {
        ok: false,
        provider: this.id,
        endpoint,
        models: [],
        error: normalized.error,
      };
    }
  }

  async listModels(endpoint: string): Promise<LocalModelDescriptor[]> {
    const health = await this.checkHealth(endpoint);
    if (!health.ok) {
      throw new LocalAdapterError(health.error || "Failed to list Ollama models.", "discovery_failed");
    }
    return health.models;
  }

  async infer(
    endpoint: string,
    request: LocalInferenceRequest,
    signal?: AbortSignal,
  ): Promise<LocalInferenceResponse> {
    try {
      const url = validateLoopbackUrl(endpoint);
      const chatUrl = new URL("/api/chat", url).toString();

      const messages = [];
      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }
      messages.push({ role: "user", content: request.prompt });

      const payload: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: false,
      };

      if (request.formatJson) {
        payload.format = "json";
      }

      if (request.temperature !== undefined) {
        payload.options = { temperature: request.temperature };
      }

      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: signal || AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        if (res.status === 404) {
          throw new LocalAdapterError(
            `Ollama model "${request.model}" not found. Try running "ollama pull ${request.model}".`,
            "model_not_found",
          );
        }
        throw new LocalAdapterError(
          `Ollama returned HTTP ${res.status}: ${errorText || res.statusText}`,
          "inference_failed",
        );
      }

      const data = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const content = data.message?.content || "";
      return {
        ok: true,
        content,
        model: request.model,
        provider: this.id,
        usage: {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
      };
    } catch (err) {
      return normalizeLocalError(err, this.id);
    }
  }
}
