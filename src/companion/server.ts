import http from "node:http";
import { LlamaCppAdapter } from "./adapters/llamacpp-adapter";
import { OllamaAdapter } from "./adapters/ollama-adapter";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible-adapter";
import type { LocalRuntimeAdapter } from "./adapters/runtime-adapter";
import {
  CompanionTokenManager,
  DEFAULT_ALLOWED_ORIGINS,
  validateConfiguredOrigin,
  validateOrigin,
} from "./security";
import {
  DEFAULT_RUNTIME_ENDPOINTS,
  isModelId,
  validateLoopbackUrl,
} from "./network-policy";
import type { LocalInferenceRequest, LocalProviderType } from "./types";

export type CompanionServerOptions = {
  port?: number;
  host?: string;
  pairingSecret?: string;
  allowedOrigins?: string[];
  tokenTtlMs?: number;
  pairingTtlMs?: number;
  silent?: boolean;
  runtimeEndpoints?: Partial<Record<LocalProviderType, string>>;
};
const MAX_BODY = 96 * 1024;
const routes = new Map([
  ["/health", "GET"],
  ["/pair", "POST"],
  ["/unpair", "POST"],
  ["/v1/status", "POST"],
  ["/v1/infer", "POST"],
]);

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("invalid_request");
  return value as Record<string, unknown>;
}
function inference(value: unknown): LocalInferenceRequest {
  const v = record(value, [
    "model",
    "prompt",
    "systemPrompt",
    "temperature",
    "maxTokens",
    "formatJson",
  ]);
  if (
    !isModelId(v.model) ||
    typeof v.prompt !== "string" ||
    !v.prompt.trim() ||
    Buffer.byteLength(v.prompt) > 64 * 1024 ||
    (v.systemPrompt !== undefined &&
      (typeof v.systemPrompt !== "string" ||
        Buffer.byteLength(v.systemPrompt) > 8192)) ||
    (v.temperature !== undefined &&
      (typeof v.temperature !== "number" ||
        !Number.isFinite(v.temperature) ||
        v.temperature < 0 ||
        v.temperature > 2)) ||
    (v.maxTokens !== undefined &&
      (!Number.isInteger(v.maxTokens) ||
        Number(v.maxTokens) < 1 ||
        Number(v.maxTokens) > 4096)) ||
    (v.formatJson !== undefined && v.formatJson !== true)
  )
    throw new Error("invalid_request");
  return {
    model: v.model,
    prompt: v.prompt,
    systemPrompt: v.systemPrompt as string | undefined,
    temperature: Number(v.temperature ?? 0.2),
    maxTokens: Number(v.maxTokens ?? 2048),
    formatJson: true,
  };
}

export class CompanionServer {
  readonly version = "2.0.0";
  readonly host: string;
  readonly port: number;
  readonly tokenManager: CompanionTokenManager;
  readonly allowedOrigins: string[];
  readonly adapters: Record<LocalProviderType, LocalRuntimeAdapter> = {
    ollama: new OllamaAdapter(),
    llamacpp: new LlamaCppAdapter(),
    openai_compatible: new OpenAiCompatibleAdapter(),
  };
  private readonly endpoints: Record<LocalProviderType, string>;
  private server: http.Server | null = null;
  private busy = false;
  private pairAttempts: number[] = [];
  constructor(options: CompanionServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 41400;
    this.allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
    if (
      !this.allowedOrigins.length ||
      this.allowedOrigins.some((o) => !validateConfiguredOrigin(o))
    )
      throw new Error("Invalid allowed origins.");
    this.tokenManager = new CompanionTokenManager(
      options.pairingSecret,
      options.tokenTtlMs,
      options.pairingTtlMs,
    );
    this.endpoints = {
      ...DEFAULT_RUNTIME_ENDPOINTS,
      ...options.runtimeEndpoints,
    };
    for (const provider of Object.keys(this.endpoints) as LocalProviderType[]) {
      const url = validateLoopbackUrl(this.endpoints[provider]);
      if (provider !== "openai_compatible" && url.pathname !== "/")
        throw new Error("Invalid runtime path.");
      if (url.port === String(this.port))
        throw new Error("Runtime cannot target the companion.");
      this.endpoints[provider] = url.toString();
    }
  }
  private send(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    origin?: string,
  ) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    });
    res.end(JSON.stringify(body));
  }
  private async body(req: http.IncomingMessage): Promise<unknown> {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json")
      throw new Error("invalid_request");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error("request_too_large");
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("invalid_request");
    }
  }
  private runtime(value: Record<string, unknown>) {
    if (
      typeof value.provider !== "string" ||
      !Object.hasOwn(this.endpoints, value.provider)
    )
      throw new Error("invalid_provider");
    const provider = value.provider as LocalProviderType;
    // Endpoint is an assertion of the local configuration, never routing authority.
    if (
      value.endpoint !== undefined &&
      (typeof value.endpoint !== "string" ||
        validateLoopbackUrl(value.endpoint).toString() !==
          this.endpoints[provider])
    )
      throw new Error("runtime_not_configured");
    return {
      provider,
      endpoint: this.endpoints[provider],
      adapter: this.adapters[provider],
    };
  }
  handleRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const address = req.socket.localPort;
    if (
      req.socket.remoteAddress !== "127.0.0.1" ||
      host !== `127.0.0.1:${address}`
    ) {
      this.send(res, 403, { ok: false, error: "invalid_host" });
      return;
    }
    const route = req.url ?? "";
    const method = routes.get(route);
    // The only originless operation is non-sensitive loopback health for CLI smoke checks.
    if (
      !validateOrigin(origin, this.allowedOrigins) &&
      !(route === "/health" && req.method === "GET" && !origin)
    ) {
      this.send(res, 403, { ok: false, error: "invalid_origin" });
      return;
    }
    if (!method) {
      this.send(res, 404, { ok: false, error: "unsupported_route" }, origin);
      return;
    }
    if (req.method === "OPTIONS") {
      const requestedHeaders = (
        req.headers["access-control-request-headers"] ?? ""
      )
        .toString()
        .toLowerCase()
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      if (
        req.headers["access-control-request-method"] !== method ||
        requestedHeaders.some(
          (h) => !["authorization", "content-type"].includes(h),
        )
      ) {
        this.send(res, 403, { ok: false, error: "invalid_preflight" }, origin);
        return;
      }
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin!,
        Vary: "Origin",
        "Access-Control-Allow-Methods": method,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "60",
        ...(req.headers["access-control-request-private-network"] === "true"
          ? { "Access-Control-Allow-Private-Network": "true" }
          : {}),
      });
      res.end();
      return;
    }
    if (req.method !== method) {
      this.send(res, 405, { ok: false, error: "unsupported_method" }, origin);
      return;
    }
    if (route === "/health") {
      this.send(
        res,
        200,
        { ok: true, companion: "running", version: this.version },
        origin,
      );
      return;
    }
    const token = req.headers.authorization?.match(
      /^Bearer (fwd_comp_[a-f0-9]{64})$/,
    )?.[1];
    if (route !== "/pair" && !this.tokenManager.verify(token, origin)) {
      this.send(res, 401, { ok: false, error: "pairing_invalid" }, origin);
      return;
    }
    try {
      if (route === "/pair") {
        this.pairAttempts = this.pairAttempts.filter(
          (t) => t > Date.now() - 60_000,
        );
        if (this.pairAttempts.length >= 10) {
          this.send(
            res,
            429,
            { ok: false, error: "pairing_rate_limit" },
            origin,
          );
          return;
        }
        this.pairAttempts.push(Date.now());
        const body = record(await this.body(req), ["pairingSecret"]);
        const result = this.tokenManager.pair(body.pairingSecret, origin!);
        this.send(res, result.ok ? 200 : 401, result, origin);
        return;
      }
      if (route === "/unpair") {
        this.tokenManager.revoke(token);
        this.send(res, 200, { ok: true }, origin);
        return;
      }
      const body = record(
        await this.body(req),
        route === "/v1/infer"
          ? ["provider", "endpoint", "request"]
          : ["provider", "endpoint"],
      );
      const { adapter, provider, endpoint } = this.runtime(body);
      if (this.busy) {
        this.send(res, 429, { ok: false, error: "companion_busy" }, origin);
        return;
      }
      this.busy = true;
      try {
        if (route === "/v1/status") {
          const result = await adapter.checkHealth(endpoint);
          if (!this.tokenManager.verify(token, origin))
            this.send(
              res,
              401,
              { ok: false, error: "pairing_invalid" },
              origin,
            );
          else
            this.send(
              res,
              200,
              {
                ...result,
                version: this.version,
                paired: true,
                runtimeConnected: result.ok,
              },
              origin,
            );
        } else {
          const controller = new AbortController();
          const abort = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.on("close", abort);
          try {
            const result = await adapter.infer(
              endpoint,
              inference(body.request),
              controller.signal,
            );
            // Re-pair/unpair during inference prevents delivery to the revoked session.
            if (!this.tokenManager.verify(token, origin))
              this.send(
                res,
                401,
                { ok: false, error: "pairing_invalid" },
                origin,
              );
            else
              this.send(
                res,
                result.ok ? 200 : 502,
                { ...result, provider },
                origin,
              );
          } finally {
            res.off("close", abort);
          }
        }
      } finally {
        this.busy = false;
      }
    } catch {
      if (!res.destroyed)
        this.send(
          res,
          400,
          { ok: false, error: "invalid_request_or_runtime" },
          origin,
        );
    }
  };
  start(
    port = this.port,
    host = this.host,
  ): Promise<{ port: number; host: string; pairingSecret: string }> {
    if (host !== "127.0.0.1")
      throw new Error("Companion must bind to 127.0.0.1.");
    return new Promise((resolve, reject) => {
      this.server = http.createServer(
        { requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
        (req, res) => {
          void this.handleRequest(req, res).catch(() => {
            if (!res.destroyed)
              this.send(res, 500, { ok: false, error: "companion_error" });
          });
        },
      );
      this.server.maxConnections = 16;
      this.server.listen(port, host, () => {
        const addr = this.server!.address();
        resolve({
          port: typeof addr === "object" && addr ? addr.port : port,
          host,
          pairingSecret: this.tokenManager.getPairingSecret(),
        });
      });
      this.server.on("error", reject);
    });
  }
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
      this.server = null;
    });
  }
}
