import crypto from "node:crypto";
export { isLoopbackHost, validateLoopbackUrl } from "./network-policy";

export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function validateOrigin(
  origin: string | undefined,
  allowed: readonly string[] = DEFAULT_ALLOWED_ORIGINS,
): boolean {
  return typeof origin === "string" && allowed.includes(origin);
}

export function validateConfiguredOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || DEFAULT_ALLOWED_ORIGINS.includes(origin))
    );
  } catch {
    return false;
  }
}

export class CompanionTokenManager {
  private active: { token: string; origin: string; expires: number; identity?: string } | null =
    null;
  private readonly secret: string;
  private readonly secretExpires: number;
  constructor(
    secret?: string,
    private readonly ttl = 15 * 60_000,
    pairingTtl = 5 * 60_000,
  ) {
    this.secret = secret || crypto.randomBytes(32).toString("hex");
    this.secretExpires = Date.now() + pairingTtl;
  }
  getPairingSecret() {
    return this.secret;
  }
  pair(secret: unknown, origin: string, identity?: string) {
    const provided = Buffer.from(typeof secret === "string" ? secret : "");
    const expected = Buffer.from(this.secret);
    if (
      Date.now() >= this.secretExpires ||
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(provided, expected)
    ) {
      return {
        ok: false as const,
        error:
          "Pairing code invalid or expired. Restart the companion for a new code.",
      };
    }
    const token = `fwd_comp_${crypto.randomBytes(32).toString("hex")}`;
    this.active = { token, origin, expires: Date.now() + this.ttl, identity };
    return {
      ok: true as const,
      token,
      expiresAt: new Date(this.active.expires).toISOString(),
    };
  }
  verify(token: string | undefined, origin?: string, identity?: string): boolean {
    this.purgeExpired();
    return (
      !!this.active &&
      token === this.active.token &&
      origin === this.active.origin && identity === this.active.identity
    );
  }
  revoke(token: string | undefined): boolean {
    if (!this.active || token !== this.active.token) return false;
    this.active = null;
    return true;
  }
  purgeExpired() {
    if (this.active && Date.now() >= this.active.expires) this.active = null;
  }
}

export function redactSensitiveInfo(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/fwd_comp_[A-Za-z0-9]+/g, "fwd_comp_[REDACTED]")
    .replace(/Pairing Secret:\s*\S+/gi, "Pairing Secret: [REDACTED]")
    .replace(
      /"(?:token|pairingSecret)"\s*:\s*"[^"]*"/g,
      '"secret":"[REDACTED]"',
    );
}
