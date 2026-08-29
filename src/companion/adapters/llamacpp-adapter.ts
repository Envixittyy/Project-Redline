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

export class LlamaCppAdapter implements LocalRuntimeAdapter {
  readonly id = "llamacpp" as const;

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
      const healthUrl = new URL("/health", url).toString();
      const res = await fetch(healthUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }).catch(async () => {
        // Fallback to /v1/models if /health is not implemented
        const modelsUrl = new URL("/v1/models", url).toString();
        return fetch(modelsUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
      });

      if (!res.ok) {
        return {
          ok: false,
          provider: this.id,
          endpoint,
          models: [],
          error: `llama.cpp server returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      // Try discovering loaded models from /v1/models
      let models: LocalModelDescriptor[] = [];
      try {
        const modelsUrl = new URL("/v1/models", url).toString();
        const modelsRes = await fetch(modelsUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (modelsRes.ok) {
          const data = (await modelsRes.json()) as { data?: Array<{ id: string; name?: string }> };
          models = (data.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            provider: this.id,
          }));
        }
      } catch {
        // llama.cpp server may host a single active loaded model without /v1/models
        models = [{ id: "default", name: "Loaded Model", provider: this.id }];
      }

      if (models.length === 0) {
        models = [{ id: "default", name: "Loaded Model", provider: this.id }];
      }

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
      throw new LocalAdapterError(health.error || "Failed to query llama.cpp server.", "discovery_failed");
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
      const chatUrl = new URL("/v1/chat/completions", url).toString();

      const messages = [];
      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }
      messages.push({ role: "user", content: request.prompt });

      const payload: Record<string, unknown> = {
        model: request.model || "default",
        messages,
        temperature: request.temperature ?? 0.2,
      };

      if (request.formatJson) {
        payload.response_format = { type: "json_object" };
      }

      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: signal || AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new LocalAdapterError(
          `llama.cpp returned HTTP ${res.status}: ${errorText || res.statusText}`,
          "inference_failed",
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const choice = data.choices?.[0];
      const content = choice?.message?.content || "";

      return {
        ok: true,
        content,
        model: request.model,
        provider: this.id,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    } catch (err) {
      return normalizeLocalError(err, this.id);
    }
  }
}

