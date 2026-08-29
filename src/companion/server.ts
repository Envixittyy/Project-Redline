import http from "node:http";
import { LlamaCppAdapter } from "./adapters/llamacpp-adapter";
import { OllamaAdapter } from "./adapters/ollama-adapter";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible-adapter";
import type { LocalRuntimeAdapter } from "./adapters/runtime-adapter";
import {
  CompanionTokenManager,
  DEFAULT_ALLOWED_ORIGINS,
  isLoopbackHost,
  redactSensitiveInfo,
  validateOrigin,
} from "./security";
import type {
  CompanionInferencePayload,
  CompanionPairRequest,
  LocalProviderType,
} from "./types";

export type CompanionServerOptions = {
  port?: number;
  host?: string;
  pairingSecret?: string;
  allowedOrigins?: string[];
  tokenTtlMs?: number;
  silent?: boolean;
};

export class CompanionServer {
  readonly version = "1.0.0";
  readonly host: string;
  readonly port: number;
  readonly tokenManager: CompanionTokenManager;
  readonly allowedOrigins: string[];
  readonly adapters: Record<LocalProviderType, LocalRuntimeAdapter>;
  private server: http.Server | null = null;
  private silent: boolean;

  constructor(options: CompanionServerOptions = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = options.port !== undefined ? options.port : 41400;
    this.silent = options.silent ?? false;
    this.allowedOrigins = options.allowedOrigins || DEFAULT_ALLOWED_ORIGINS;
    this.tokenManager = new CompanionTokenManager(options.pairingSecret, options.tokenTtlMs);

    this.adapters = {
      ollama: new OllamaAdapter(),
      llamacpp: new LlamaCppAdapter(),
      openai_compatible: new OpenAiCompatibleAdapter(),
    };
  }

  private log(message: string): void {
    if (!this.silent) {
      console.log(`[local-companion] ${redactSensitiveInfo(message)}`);
    }
  }

  private parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) {
          // 5MB safety limit
          reject(new Error("Payload too large."));
        }
      });
      req.on("end", () => {
        try {
          resolve(data ? (JSON.parse(data) as T) : ({} as T));
        } catch {
          reject(new Error("Invalid JSON body."));
        }
      });
      req.on("error", (err) => reject(err));
    });
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    body: unknown,
    origin?: string,
  ): void {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    };

    if (origin && validateOrigin(origin, this.allowedOrigins)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(body));
  }

  private extractBearerToken(req: http.IncomingMessage): string | undefined {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return undefined;
    return auth.slice(7).trim();
  }

  handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const origin = req.headers.origin as string | undefined;
    const remoteIp = req.socket.remoteAddress || "";
    const isLocalConnection =
      isLoopbackHost(remoteIp) || remoteIp.includes("127.0.0.1") || remoteIp.includes("::1");
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      if (origin && validateOrigin(origin, this.allowedOrigins)) {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
      }
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Origin not allowed");
      return;
    }

    // Origin validation:
    // If an Origin header is explicitly sent (e.g. browser fetch), it must be in allowedOrigins.
    if (origin && !validateOrigin(origin, this.allowedOrigins)) {
      this.sendJson(res, 403, { ok: false, error: "Origin not allowed." }, origin);
      return;
    }

    // If no Origin header is sent (e.g. server-side fetch from Next.js server actions or node),
    // require that the TCP socket connection is from a local loopback IP.
    if (!origin && !isLocalConnection) {
      this.sendJson(res, 403, { ok: false, error: "Non-local connection forbidden." });
      return;
    }

    // 1. GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      this.sendJson(
        res,
        200,
        {
          ok: true,
          companion: "running",
          version: this.version,
        },
        origin,
      );
      return;
    }

    // 2. POST /pair
    if (req.method === "POST" && url.pathname === "/pair") {
      try {
        const body = await this.parseJsonBody<CompanionPairRequest>(req);
        const pairResult = this.tokenManager.pair(body.pairingSecret, origin || body.clientOrigin || "unknown");
        if (!pairResult.ok) {
          this.sendJson(res, 401, { ok: false, error: pairResult.error }, origin);
          return;
        }

        this.log(`Client paired successfully from origin "${origin || body.clientOrigin}"`);
        this.sendJson(res, 200, pairResult, origin);
      } catch (err) {
        this.sendJson(res, 400, { ok: false, error: (err as Error).message }, origin);
      }
      return;
    }

    // 3. POST /unpair (Authenticated)
    if (req.method === "POST" && url.pathname === "/unpair") {
      const token = this.extractBearerToken(req);
      if (!this.tokenManager.verify(token)) {
        this.sendJson(res, 401, { ok: false, error: "Unauthorized or expired token." }, origin);
        return;
      }

      this.tokenManager.revoke(token);
      this.log("Token revoked (unpaired).");
      this.sendJson(res, 200, { ok: true, message: "Unpaired successfully." }, origin);
      return;
    }

    // All endpoints below require authentication
    const token = this.extractBearerToken(req);
    if (!this.tokenManager.verify(token)) {
      this.sendJson(res, 401, { ok: false, error: "Unauthorized. Valid bearer pairing token required." }, origin);
      return;
    }

    // 4. POST /v1/status or GET /v1/status
    if ((req.method === "POST" || req.method === "GET") && url.pathname === "/v1/status") {
      try {
        let provider: LocalProviderType = "ollama";
        let endpoint = "http://127.0.0.1:11434";

        if (req.method === "POST") {
          const body = await this.parseJsonBody<{ provider?: LocalProviderType; endpoint?: string }>(req);
          if (body.provider) provider = body.provider;
          if (body.endpoint) endpoint = body.endpoint;
        } else {
          const qProvider = url.searchParams.get("provider");
          const qEndpoint = url.searchParams.get("endpoint");
          if (qProvider && (qProvider === "ollama" || qProvider === "llamacpp" || qProvider === "openai_compatible")) {
            provider = qProvider;
          }
          if (qEndpoint) endpoint = qEndpoint;
        }

        const adapter = this.adapters[provider];
        if (!adapter) {
          this.sendJson(res, 400, { ok: false, error: `Unsupported provider "${provider}".` }, origin);
          return;
        }

        const health = await adapter.checkHealth(endpoint);
        this.sendJson(
          res,
          200,
          {
            ok: health.ok,
            version: this.version,
            paired: true,
            provider,
            endpoint,
            runtimeConnected: health.ok,
            models: health.models,
            error: health.error,
          },
          origin,
        );
      } catch (err) {
        this.sendJson(res, 500, { ok: false, error: (err as Error).message }, origin);
      }
      return;
    }

    // 5. POST /v1/infer
    if (req.method === "POST" && url.pathname === "/v1/infer") {
      try {
        const body = await this.parseJsonBody<CompanionInferencePayload>(req);
        if (!body.provider || !body.endpoint || !body.request) {
          this.sendJson(res, 400, { ok: false, error: "Missing provider, endpoint, or request." }, origin);
          return;
        }

        const adapter = this.adapters[body.provider];
        if (!adapter) {
          this.sendJson(res, 400, { ok: false, error: `Unsupported provider "${body.provider}".` }, origin);
          return;
        }

        this.log(`Executing inference on ${body.provider} (${body.endpoint}) for model "${body.request.model}"`);
        const result = await adapter.infer(body.endpoint, body.request);
        this.sendJson(res, result.ok ? 200 : 502, result, origin);
      } catch (err) {
        this.sendJson(res, 500, { ok: false, error: (err as Error).message }, origin);
      }
      return;
    }

    // 404 Not Found
    this.sendJson(res, 404, { ok: false, error: `Endpoint not found: ${req.method} ${url.pathname}` }, origin);
  };

  start(port?: number, host?: string): Promise<{ port: number; host: string; pairingSecret: string }> {
    const listenPort = port !== undefined ? port : this.port;
    const listenHost = host || this.host;

    if (!isLoopbackHost(listenHost)) {
      throw new Error(`Companion must bind to a loopback address. "${listenHost}" is forbidden.`);
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handleRequest);
      this.server.listen(listenPort, listenHost, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : listenPort;
        this.log(`Listening on http://${listenHost}:${actualPort}`);
        this.log(`Pairing Secret: ${this.tokenManager.getPairingSecret()}`);
        resolve({
          port: actualPort,
          host: listenHost,
          pairingSecret: this.tokenManager.getPairingSecret(),
        });
      });
      this.server.on("error", (err) => reject(err));
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      this.server = null;
    });
  }
}

