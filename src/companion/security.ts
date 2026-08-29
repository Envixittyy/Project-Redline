import crypto from "node:crypto";

/** Default allowed origins for local Forward instances */
export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Validates whether a hostname or IP address is strictly on the local loopback interface.
 * Rejects private LAN, public WAN, and arbitrary remote hosts.
 */
export function isLoopbackHost(hostname: string): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase().trim();

  // Strip brackets if IPv6 e.g. [::1] or [::1]:8080
  let cleaned = lower;
  if (cleaned.startsWith("[")) {
    const endBracket = cleaned.indexOf("]");
    if (endBracket !== -1) {
      cleaned = cleaned.slice(1, endBracket);
    }
  } else if (cleaned.includes(":") && !cleaned.includes("::")) {
    // IPv4 with port e.g. localhost:8080 or 127.0.0.1:8080
    cleaned = cleaned.split(":")[0];
  }

  if (LOOPBACK_HOSTNAMES.has(cleaned)) {
    return true;
  }

  // Check 127.x.x.x loopback range
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/.test(cleaned)) {
    return true;
  }

  return false;
}

/**
 * Validates a target runtime endpoint URL to ensure it is strictly a valid loopback HTTP URL.
 * Throws an Error with a safe message if the endpoint is invalid or off-loopback.
 */
export function validateLoopbackUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL format: "${urlStr}".`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid protocol "${parsed.protocol}". Only HTTP is allowed for local loopback.`);
  }

  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `Security violation: Target endpoint "${parsed.hostname}" is not a local loopback address. LAN, WAN, and remote endpoints are forbidden.`,
    );
  }

  return parsed;
}

/**
 * Validates incoming request Origin header against allowed web application origins.
 */
export function validateOrigin(
  originHeader: string | undefined,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS,
): boolean {
  if (!originHeader) return false;
  const normalized = originHeader.trim().toLowerCase();
  return allowedOrigins.some((allowed) => allowed.toLowerCase() === normalized);
}

export type TokenRecord = {
  token: string;
  clientOrigin: string;
  createdAt: number;
  expiresAt: number;
};

export class CompanionTokenManager {
  private activeTokens = new Map<string, TokenRecord>();
  private readonly pairingSecret: string;
  private readonly tokenTtlMs: number;

  constructor(pairingSecret?: string, tokenTtlMs = 24 * 60 * 60 * 1000) {
    this.pairingSecret = pairingSecret || crypto.randomBytes(16).toString("hex");
    this.tokenTtlMs = tokenTtlMs;
  }

  getPairingSecret(): string {
    return this.pairingSecret;
  }

  /**
   * Validates pairing secret and issues a cryptographically secure ephemeral bearer token.
   */
  pair(providedSecret: string, clientOrigin: string): { ok: true; token: string; expiresAt: string } | { ok: false; error: string } {
    if (!providedSecret || providedSecret.trim() !== this.pairingSecret) {
      return { ok: false, error: "Invalid pairing secret." };
    }

    const token = `fwd_comp_${crypto.randomBytes(24).toString("hex")}`;
    const now = Date.now();
    const expiresAtMs = now + this.tokenTtlMs;

    this.activeTokens.set(token, {
      token,
      clientOrigin,
      createdAt: now,
      expiresAt: expiresAtMs,
    });

    return {
      ok: true,
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Validates an ephemeral bearer token and checks expiration.
   */
  verify(token: string | undefined): boolean {
    if (!token) return false;
    const record = this.activeTokens.get(token);
    if (!record) return false;

    if (Date.now() > record.expiresAt) {
      this.activeTokens.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Revokes an active token.
   */
  revoke(token: string | undefined): boolean {
    if (!token) return false;
    return this.activeTokens.delete(token);
  }

  /**
   * Cleans up expired tokens.
   */
  purgeExpired(): void {
    const now = Date.now();
    for (const [token, record] of this.activeTokens.entries()) {
      if (now > record.expiresAt) {
        this.activeTokens.delete(token);
      }
    }
  }
}

/**
 * Redacts secrets, tokens, authorization headers, and raw prompts from log output.
 */
export function redactSensitiveInfo(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, "Bearer [REDACTED]")
    .replace(/fwd_comp_[A-Za-z0-9]+/gi, "fwd_comp_[REDACTED]")
    .replace(/"pairingSecret"\s*:\s*"[^"]+"/gi, '"pairingSecret":"[REDACTED]"')
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"[REDACTED]"');
}

