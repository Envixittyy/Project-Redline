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

export class OpenAiCompatibleAdapter implements LocalRuntimeAdapter {
  readonly id = "openai_compatible" as const;

  getCapabilities(): LocalRuntimeCapabilities {
    return {
      streaming: true,
      jsonFormat: true,
      modelDiscovery: true,
      abortSignal: true,
    };
  }

  private resolveUrl(endpoint: string, path: string): string {
    const parsed = validateLoopbackUrl(endpoint);
    // If the endpoint already ends with /v1, don't duplicate it
    const trimmedPath = parsed.pathname.replace(/\/$/, "");
    const subPath = path.startsWith("/") ? path : `/${path}`;
    if (trimmedPath.endsWith("/v1") && subPath.startsWith("/v1/")) {
      return new URL(`${trimmedPath}${subPath.slice(3)}`, parsed.origin).toString();
    }
    return new URL(`${trimmedPath}${subPath}`, parsed.origin).toString();
  }

  async checkHealth(endpoint: string): Promise<RuntimeHealthResult> {
    try {
      const modelsUrl = this.resolveUrl(endpoint, "/v1/models");
      const res = await fetch(modelsUrl, {
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
          error: `OpenAI-compatible server returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
      const models: LocalModelDescriptor[] = (data.data || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: this.id,
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
      throw new LocalAdapterError(health.error || "Failed to list OpenAI-compatible models.", "discovery_failed");
    }
    return health.models;
  }

  async infer(
    endpoint: string,
    request: LocalInferenceRequest,
    signal?: AbortSignal,
  ): Promise<LocalInferenceResponse> {
    try {
      const chatUrl = this.resolveUrl(endpoint, "/v1/chat/completions");

      const messages = [];
      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }
      messages.push({ role: "user", content: request.prompt });

      const payload: Record<string, unknown> = {
        model: request.model,
        messages,
        temperature: request.temperature ?? 0.2,
      };

      if (request.maxTokens) {
        payload.max_tokens = request.maxTokens;
      }

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
          `Local endpoint returned HTTP ${res.status}: ${errorText || res.statusText}`,
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

