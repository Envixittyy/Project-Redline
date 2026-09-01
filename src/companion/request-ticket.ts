import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export type CompanionTicket = {
  audience: string; origin: string; userId: string; deviceId: string;
  path: string; bodyDigest: string; tokenHash: string;
  capability: "session" | "taskChecklist.propose" | "courseImport.propose" | "schoolAssessmentPrediction.propose";
};
export function ticketDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function signCompanionTicket(key: string, ticket: CompanionTicket) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("companion_auth_not_configured");
  const payload = Buffer.from(JSON.stringify({ ...ticket, version: 1, nonce: randomUUID(), expires: Date.now() + 60_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", Buffer.from(key, "hex")).update(payload).digest("hex")}`;
}
/** Per-process replay cache is safe: restart also revokes all pairing sessions. */
export class CompanionTicketVerifier {
  private readonly used = new Map<string, number>();
  constructor(private readonly key: string, private readonly audience: string) {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("companion_auth_not_configured");
  }
  verify(raw: unknown, origin: string, path: string, body: unknown, token?: string) {
    if (typeof raw !== "string" || raw.length > 4096) throw new Error("authorization_denied");
    const [payload, mac, extra] = raw.split(".");
    if (extra || !/^[a-f0-9]{64}$/.test(mac ?? "")) throw new Error("authorization_denied");
    const expected = createHmac("sha256", Buffer.from(this.key, "hex")).update(payload).digest();
    if (!timingSafeEqual(Buffer.from(mac, "hex"), expected)) throw new Error("authorization_denied");
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Date.now();
    for (const [id, expiry] of this.used) if (expiry <= now) this.used.delete(id);
    if (t.version !== 1 || t.audience !== this.audience || t.origin !== origin || t.path !== path ||
        t.bodyDigest !== ticketDigest(body) || t.tokenHash !== ticketDigest(token ?? null) ||
        !Number.isSafeInteger(t.expires) || t.expires <= now || t.expires > now + 65_000 ||
        !UUID.test(t.userId) || !UUID.test(t.deviceId) || !UUID.test(t.nonce) ||
        this.used.has(t.nonce) || this.used.size >= 1000 ||
        (path === "/v1/infer" ? !["taskChecklist.propose", "courseImport.propose", "schoolAssessmentPrediction.propose"].includes(t.capability) : t.capability !== "session")) throw new Error("authorization_denied");
    this.used.set(t.nonce, t.expires);
    return t as CompanionTicket;
  }
}
