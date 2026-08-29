import {
  parseAiActionProposal,
  type AiActionProposal,
} from "./action-contract";
import type {
  AiContextEnvelope,
  LocalCompanionConfig,
  LocalCompanionStatus,
  LocalProviderType,
} from "./types";

export class LocalCompanionClientError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "LocalCompanionClientError";
  }
}

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

/**
 * Checks if the Local Companion daemon is running and reachable on loopback.
 */
export async function checkCompanionHealth(
  companionUrl = "http://127.0.0.1:41400",
): Promise<CompanionHealthResponse> {
  try {
    const url = new URL("/health", companionUrl).toString();
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return {
        ok: false,
        companion: "unknown",
        version: "unknown",
        error: `Companion returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = (await res.json()) as { companion?: string; version?: string };
    return {
      ok: true,
      companion: data.companion || "running",
      version: data.version || "1.0.0",
    };
  } catch (err) {
    return {
      ok: false,
      companion: "disconnected",
      version: "unknown",
      error: err instanceof Error ? err.message : "Companion daemon is not running.",
    };
  }
}

/**
 * Performs pairing handshake with the Local Companion daemon.
 */
export async function pairCompanion(
  companionUrl = "http://127.0.0.1:41400",
  pairingSecret: string,
  clientOrigin = "http://localhost:3000",
): Promise<CompanionPairResult> {
  try {
    const url = new URL("/pair", companionUrl).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pairingSecret,
        clientOrigin,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await res.json()) as {
      ok: boolean;
      token?: string;
      expiresAt?: string;
      error?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `Pairing failed with status ${res.status}`,
      };
    }

    return {
      ok: true,
      token: data.token,
      expiresAt: data.expiresAt,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not connect to companion daemon.",
    };
  }
}

/**
 * Revokes the active pairing token with the Local Companion daemon.
 */
export async function unpairCompanion(
  companionUrl = "http://127.0.0.1:41400",
  token: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const url = new URL("/unpair", companionUrl).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { ok: false, message: `Unpair returned HTTP ${res.status}` };
    }

    return { ok: true, message: "Unpaired successfully." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to unpair companion.",
    };
  }
}

/**
 * Retrieves the status of the local runtime (Ollama, llama.cpp, etc.) via the companion daemon.
 */
export async function getCompanionStatus(
  config: LocalCompanionConfig,
): Promise<LocalCompanionStatus> {
  const companionUrl = config.companionUrl || "http://127.0.0.1:41400";
  const health = await checkCompanionHealth(companionUrl);
  if (!health.ok) {
    return {
      companionRunning: false,
      paired: false,
      runtimeConnected: false,
      models: [],
      error: health.error,
    };
  }

  if (!config.pairingToken) {
    return {
      companionRunning: true,
      paired: false,
      runtimeConnected: false,
      models: [],
      error: "Companion is running but not paired. Enter pairing secret to connect.",
    };
  }

  try {
    const url = new URL("/v1/status", companionUrl).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.pairingToken}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        provider: config.provider,
        endpoint: config.endpoint,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401) {
      return {
        companionRunning: true,
        paired: false,
        runtimeConnected: false,
        models: [],
        error: "Pairing token expired or invalid. Please re-pair.",
      };
    }

    const data = (await res.json()) as {
      ok: boolean;
      paired: boolean;
      runtimeConnected: boolean;
      models?: Array<{ id: string; name: string; provider: LocalProviderType }>;
      error?: string;
    };

    return {
      companionRunning: true,
      paired: data.paired ?? true,
      runtimeConnected: data.runtimeConnected ?? false,
      models: data.models || [],
      error: data.error,
    };
  } catch (err) {
    return {
      companionRunning: true,
      paired: true,
      runtimeConnected: false,
      models: [],
      error: err instanceof Error ? err.message : "Failed to query runtime status.",
    };
  }
}

/**
 * Dispatches an inference request to the Local AI Companion and parses the result into an AiActionProposal.
 */
export async function executeLocalInference(
  config: LocalCompanionConfig,
  prompt: string,
  _envelope?: AiContextEnvelope,
): Promise<AiActionProposal> {
  const companionUrl = config.companionUrl || "http://127.0.0.1:41400";

  if (!config.pairingToken) {
    throw new LocalCompanionClientError(
      "Local companion is not paired. Please pair the companion in settings before using local AI.",
      "not_paired",
    );
  }

  const inferUrl = new URL("/v1/infer", companionUrl).toString();
  let res: Response;
  try {
    res = await fetch(inferUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.pairingToken}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        provider: config.provider,
        endpoint: config.endpoint,
        request: {
          model: config.model,
          prompt,
          systemPrompt:
            "You are Forward AI. Return your action proposal exclusively as valid JSON adhering to schema_version 1. Do not wrap in markdown or prose.",
          formatJson: true,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new LocalCompanionClientError(
      `Could not connect to Local Companion: ${err instanceof Error ? err.message : String(err)}`,
      "companion_unreachable",
    );
  }

  if (res.status === 401) {
    throw new LocalCompanionClientError(
      "Companion pairing token has expired or is invalid. Please re-pair.",
      "pairing_invalid",
    );
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new LocalCompanionClientError(
      `Local inference failed (HTTP ${res.status}): ${errBody || res.statusText}`,
      "inference_error",
    );
  }

  const jsonRes = (await res.json()) as {
    ok: boolean;
    content?: string;
    error?: string;
  };

  if (!jsonRes.ok || !jsonRes.content) {
    throw new LocalCompanionClientError(
      jsonRes.error || "Local runtime returned an empty or error response.",
      "runtime_error",
    );
  }

  // Parse structured JSON
  let parsed: unknown;
  try {
    const cleaned = jsonRes.content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new LocalCompanionClientError(
      "Local model response could not be parsed as JSON.",
      "malformed_json",
    );
  }

  const validated = parseAiActionProposal(parsed);
  if (!validated.ok) {
    throw new LocalCompanionClientError(
      `Local model output violated application schema: ${validated.issues.join("; ")}`,
      "schema_violation",
    );
  }

  return validated.value;
}

