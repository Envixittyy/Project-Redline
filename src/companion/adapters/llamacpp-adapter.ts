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

export class LlamaCppAdapter implements LocalRuntimeAdapter {
  readonly id = "llamacpp" as const;

  getCapabilities(): LocalRuntimeCapabilities {
    return {
      streaming: false,
      jsonFormat: true,
      modelDiscovery: true,
      abortSignal: true,
      imageInput: false,
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
      const signal = AbortSignal.timeout(5000);
      const health = await fetch(new URL("/health", url), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
        redirect: "error",
      });
      if (!health.ok && health.status !== 404) {
        await health.body?.cancel();
        throw new LocalAdapterError("Runtime unavailable.", "discovery_failed");
      }
      if (health.ok) {
        const status = await readBoundedJson<{ status?: string }>(health);
        if (status.status !== "ok")
          throw new LocalAdapterError(
            "Runtime unavailable.",
            "discovery_failed",
          );
      } else await health.body?.cancel();
      const response = await fetch(new URL("/v1/models", url), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
        redirect: "error",
      });
      let models: LocalModelDescriptor[];
      if (response.status === 404 && health.ok) {
        // Only an explicit unsupported discovery route permits the loaded-model fallback.
        await response.body?.cancel();
        models = [{ id: "default", name: "Loaded Model", provider: this.id }];
      } else {
        if (!response.ok) {
          await response.body?.cancel();
          throw new LocalAdapterError(
            "Runtime unavailable.",
            "discovery_failed",
          );
        }
        const data = await readBoundedJson<{ data?: Array<{ id: string }> }>(
          response,
        );
        if (!Array.isArray(data.data))
          throw new LocalAdapterError(
            "Invalid model list.",
            "malformed_response",
          );
        models = data.data
          .slice(0, 100)
          .filter((m) => m && isModelId(m.id))
          .map((m) => ({
            id: m.id,
            name: m.id,
            provider: this.id,
          }));
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
      throw new LocalAdapterError(
        health.error || "Failed to query llama.cpp server.",
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
      if (request.images !== undefined || request.media !== undefined) {
        throw new LocalAdapterError("Vision is not enabled for this capability.", "unsupported_modality");
      }
      const url = validateLoopbackUrl(endpoint);
      if (url.pathname !== "/")
        throw new LocalAdapterError(
          "Invalid runtime path.",
          "invalid_endpoint",
        );
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
        stream: false,
      };

      if (request.formatJson) {
        payload.response_format = { type: "json_object" };
      }
      if (request.maxTokens !== undefined) {
        payload.max_tokens = request.maxTokens;
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
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>(res);

      const choice = data.choices?.[0];
      const content = choice?.message?.content;
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
