import "server-only";
import { createHmac } from "node:crypto";
import { AiTrustError } from "./trust-contract";

/** No service-role bypass. The DB verifies this proof AND the authenticated owner. */
export function signAiCommand(
  userId: string,
  operation: string,
  data: Record<string, unknown>,
) {
  const key = process.env.AI_TRUST_SIGNING_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new AiTrustError("trust_not_configured");
  const message = JSON.stringify({
    version: 1,
    user_id: userId,
    operation,
    expires: Math.floor(Date.now() / 1000) + 60,
    data,
  });
  return {
    p_message: message,
    p_mac: createHmac("sha256", Buffer.from(key, "hex"))
      .update(message, "utf8")
      .digest("hex"),
  };
}
