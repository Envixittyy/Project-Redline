import { validateLoopbackUrl, isModelId } from "../network-policy";
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
  readBoundedJson,
  runtimeHttpError,
  type LocalRuntimeAdapter,
} from "./runtime-adapter";

export class OllamaAdapter implements LocalRuntimeAdapter {
  readonly id = "ollama" as const;

  getCapabilities(): LocalRuntimeCapabilities {
    return {
      streaming: false,
      jsonFormat: true,
      modelDiscovery: true,
      abortSignal: true,
    };
  }

  async checkHealth(endpoint: string): Promise<RuntimeHealthResult> {
    try {
      const url = validateLoopbackUrl(endpoint);
      if (url.pathname !== "/")
        throw new LocalAdapterError(
          "Invalid runtime path.",
          "invalid_endpoint",
        );
      const tagsUrl = new URL("/api/tags", url).toString();
      const res = await fetch(tagsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });

      if (!res.ok) {
        await res.body?.cancel();
        return {
          ok: false,
          provider: this.id,
          endpoint,
          models: [],
          error: "Local runtime request failed.",
        };
      }

      const data = await readBoundedJson<{
        models?: Array<{
          name: string;
          model?: string;
          details?: Record<string, unknown>;
        }>;
      }>(res);
      if (!Array.isArray(data.models))
        throw new LocalAdapterError(
          "Invalid model list.",
          "malformed_response",
        );
      const models: LocalModelDescriptor[] = data.models
        .slice(0, 100)
        .filter((m) => m && isModelId(m.model || m.name))
        .map((m) => ({
          id: m.model || m.name,
          name: m.model || m.name,
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
      throw new LocalAdapterError(
        health.error || "Failed to list Ollama models.",
        "discovery_failed",
      );
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
      if (url.pathname !== "/")
        throw new LocalAdapterError(
          "Invalid runtime path.",
          "invalid_endpoint",
        );
      const chatUrl = new URL("/api/chat", url).toString();

      const messages = [];
      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }
      const userMessage: Record<string, unknown> = { role: "user", content: request.prompt };
      if (request.images && request.images.length > 0) {
        userMessage.images = request.images.map((img) =>
          img.replace(/^data:image\/[a-z]+;base64,/, ""),
        );
      }
      messages.push(userMessage);

      const payload: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: false,
        keep_alive: request.keepAlive ?? "5m",
      };

      if (request.formatJson) {
        payload.format = "json";
      }

      if (
        request.temperature !== undefined ||
        request.maxTokens !== undefined
      ) {
        payload.options = {
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
          ...(request.maxTokens !== undefined
            ? { num_predict: request.maxTokens }
            : {}),
        };
      }

      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
        redirect: "error",
      });

      if (!res.ok) {
        await res.body?.cancel();
        throw runtimeHttpError(res.status);
      }

      const data = await readBoundedJson<{
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      }>(res);

      const content = data.message?.content;
      if (
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 32768
      )
        throw new LocalAdapterError(
          "Invalid model content.",
          "malformed_response",
        );
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
