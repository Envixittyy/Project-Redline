"use client";

import { readBoundedResponseText } from "@/companion/adapters/runtime-adapter";
import {
  isModelId,
  validateCompanionUrl,
  validateLoopbackUrl,
} from "@/companion/network-policy";
import type { LocalInferenceRequest } from "@/companion/types";
import type { LocalCompanionConfig, LocalCompanionStatus } from "./types";

export type CompanionHealthResponse = {
  ok: boolean;
  companion: string;
  version: string;
  error?: string;
};
export type CompanionPairResult = {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
};
export class LocalCompanionClientError extends Error {
  constructor(message: string, public readonly code = "invalid_output") { super(message); }
}
let deviceId: string | undefined;
export function companionDeviceId() { return deviceId ??= crypto.randomUUID(); }

async function request(
  base: string,
  path: string,
  init: RequestInit,
  timeout: number,
  inferenceTicket?: string,
): Promise<Record<string, unknown>> {
  // A hosted server's localhost is never the user's PC.
  if (typeof window === "undefined")
    throw new LocalCompanionClientError(
      "Companion transport requires an authenticated Forward browser session.",
    );
  const url = new URL(path, validateCompanionUrl(base));
  const remote = url.protocol === "https:";
  let ticket = inferenceTicket;
  if (remote && path !== "/v1/infer") {
    const { remoteSessionTicketAction } = await import("@/features/ai/remote-companion-actions");
    const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "") ?? null;
    const result = await remoteSessionTicketAction(path, init.body ? JSON.parse(String(init.body)) : null, token, companionDeviceId());
    if (!result.ok) throw new LocalCompanionClientError("Remote authorization unavailable.", "pairing_invalid");
    ticket = result.ticket;
  }
  if (remote && !ticket) throw new LocalCompanionClientError("Remote authorization required.", "pairing_invalid");
  const options: RequestInit & { targetAddressSpace?: "loopback" } = {
    ...init,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    ...(!remote ? { targetAddressSpace: "loopback" as const } : {}),
    headers: { ...Object.fromEntries(new Headers(init.headers)), ...(ticket ? { "X-Redline-Ticket": ticket } : {}) },
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  };
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new LocalCompanionClientError("Companion unavailable.", init.signal?.aborted ? "cancelled" : "network_unavailable"); }
  if (!response.ok) {
    let failureCode = "invalid_output";
    try {
      const body = JSON.parse(await readBoundedResponseText(response, 4096));
      if (["provider_unavailable", "rate_limited", "timeout", "invalid_output", "provider_rejected", "unsupported_modality"].includes(body.failureCode)) failureCode = body.failureCode;
    } catch { /* Never infer infrastructure failure from malformed provider output. */ }
    throw new LocalCompanionClientError(
      response.status === 401
        ? "Pairing expired or revoked. Restart and re-pair."
        : "Companion request failed.",
      response.status === 401 || response.status === 403 ? "pairing_invalid" : response.status === 429 ? "rate_limited" : failureCode,
    );
  }
  const parsed: unknown = JSON.parse(
    await readBoundedResponseText(response, 96 * 1024),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new LocalCompanionClientError("Invalid companion response.");
  return parsed as Record<string, unknown>;
}
function post(body: unknown, token?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}
export async function checkCompanionHealth(
  companionUrl = "http://127.0.0.1:41400",
): Promise<CompanionHealthResponse> {
  try {
    // Leave time for the initial browser local-network permission prompt.
    const result = await request(
      companionUrl,
      "/health",
      { method: "GET" },
      30000,
    );
    if (result.ok !== true || result.version !== "2.0.0") throw new Error();
    return { ok: true, companion: "running", version: "2.0.0" };
  } catch {
    return {
      ok: false,
      companion: "disconnected",
      version: "unknown",
      error:
        "Companion unavailable. Check the home PC and Companion, connect the private network for remote mode, and allow browser network access.",
    };
  }
}
export async function pairCompanion(
  companionUrl: string,
  pairingSecret: string,
): Promise<CompanionPairResult> {
  try {
    const result = await request(
      companionUrl,
      "/pair",
      post({ pairingSecret }),
      30000,
    );
    if (
      result.ok !== true ||
      typeof result.token !== "string" ||
      !/^fwd_comp_[a-f0-9]{64}$/.test(result.token) ||
      typeof result.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(result.expiresAt))
    )
      throw new Error();
    return { ok: true, token: result.token, expiresAt: result.expiresAt };
  } catch {
    return {
      ok: false,
      error:
        "Pairing failed. Check the origin configuration and restart for a fresh five-minute code.",
    };
  }
}
export async function unpairCompanion(
  companionUrl: string,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    await request(companionUrl, "/unpair", post({}, token), 5000);
    return { ok: true, message: "Companion access revoked." };
  } catch {
    return {
      ok: false,
      message:
        "Could not revoke access. Stop the companion to revoke immediately; the token also expires after 15 minutes.",
    };
  }
}
export async function getCompanionStatus(
  config: LocalCompanionConfig,
): Promise<LocalCompanionStatus> {
  try {
    const endpoint = validateLoopbackUrl(config.endpoint).toString();
    if (!config.pairingToken) throw new Error();
    const result = await request(
      config.companionUrl,
      "/v1/status",
      post({ provider: config.provider, endpoint }, config.pairingToken),
      16000,
    );
    const models = Array.isArray(result.models)
      ? result.models
          .filter(
            (
              m,
            ): m is {
              id: string;
              name: string;
              provider: LocalCompanionConfig["provider"];
            } =>
              !!m &&
              typeof m === "object" &&
              isModelId(m.id) &&
              typeof m.name === "string" &&
              m.name.length <= 200 &&
              m.provider === config.provider,
          )
          .slice(0, 100)
      : [];
    return {
      companionRunning: true,
      paired: true,
      runtimeConnected: result.runtimeConnected === true,
      models,
      ...(result.runtimeConnected !== true
        ? { error: "Configured runtime unavailable." }
        : {}),
    };
  } catch {
    return {
      companionRunning: false,
      paired: false,
      runtimeConnected: false,
      models: [],
      error:
        "Companion unavailable or pairing expired. Check status and re-pair.",
    };
  }
}
/** Model output remains untrusted staging data. Only server finalization can create proposals. */
export async function inferLocalContent(
  config: LocalCompanionConfig,
  inference: LocalInferenceRequest,
  signal?: AbortSignal,
  inferenceTicket?: string,
): Promise<string> {
  if (!config.pairingToken || !config.enabled || !isModelId(config.model))
    throw new LocalCompanionClientError("Local AI is not configured.", "local_unavailable");
  const endpoint = validateLoopbackUrl(config.endpoint).toString();
  const result = await request(
    config.companionUrl,
    "/v1/infer",
    {
      ...post(
        {
          provider: config.provider,
          endpoint,
          request: { ...inference, model: config.model },
        },
        config.pairingToken,
      ),
      signal,
    },
    65000,
    inferenceTicket,
  );
  if (
    result.ok !== true ||
    typeof result.content !== "string" ||
    result.content.length > 32768
  )
    throw new LocalCompanionClientError("Invalid runtime output.");
  return result.content;
}
