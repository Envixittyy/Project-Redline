import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanionServer } from "@/companion/server";
import {
  checkCompanionHealth,
  executeLocalInference,
  getCompanionStatus,
  pairCompanion,
  unpairCompanion,
} from "./companion-client";

describe("Local Companion Client Integration", () => {
  let server: CompanionServer;
  let companionUrl: string;
  const pairingSecret = "companion-client-test-secret";
  let pairingToken: string;

  beforeAll(async () => {
    server = new CompanionServer({
      port: 0,
      host: "127.0.0.1",
      pairingSecret,
      silent: true,
    });
    const info = await server.start();
    companionUrl = `http://127.0.0.1:${info.port}`;

    const pairRes = await pairCompanion(companionUrl, pairingSecret, "http://localhost:3000");
    if (pairRes.ok && pairRes.token) {
      pairingToken = pairRes.token;
    }
  });

  afterAll(async () => {
    await server.stop();
  });

  it("checks companion health when companion is running", async () => {
    const health = await checkCompanionHealth(companionUrl);
    expect(health.ok).toBe(true);
    expect(health.companion).toBe("running");
  });

  it("fails gracefully when companion daemon is offline", async () => {
    const health = await checkCompanionHealth("http://127.0.0.1:59998");
    expect(health.ok).toBe(false);
    expect(health.companion).toBe("disconnected");
  });

  it("fails pairing with invalid secret", async () => {
    const pairRes = await pairCompanion(companionUrl, "wrong-secret", "http://localhost:3000");
    expect(pairRes.ok).toBe(false);
    expect(pairRes.error).toContain("Invalid pairing secret");
  });

  it("retrieves companion status and runtime health", async () => {
    const status = await getCompanionStatus({
      enabled: true,
      companionUrl,
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      pairingToken,
    });

    expect(status.companionRunning).toBe(true);
    expect(status.paired).toBe(true);
  });

  it("rejects inference when pairing token is missing", async () => {
    await expect(
      executeLocalInference(
        {
          enabled: true,
          companionUrl,
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model: "qwen2.5:7b",
          pairingToken: null,
        },
        "Create task",
      ),
    ).rejects.toThrow(/not paired/);
  });

  it("unpairs companion successfully", async () => {
    const unpairRes = await unpairCompanion(companionUrl, pairingToken);
    expect(unpairRes.ok).toBe(true);

    const statusAfter = await getCompanionStatus({
      enabled: true,
      companionUrl,
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      pairingToken,
    });

    expect(statusAfter.paired).toBe(false);
    expect(statusAfter.error).toContain("expired or invalid");
  });
});

