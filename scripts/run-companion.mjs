#!/usr/bin/env node

/**
 * Forward Local AI Companion Runner
 * Starts the loopback companion daemon on 127.0.0.1:41400.
 */

import { CompanionServer } from "../src/companion/server.ts";

const port = 41400; // Browser transport is deliberately pinned to this port.
const host = "127.0.0.1";

const server = new CompanionServer({
  port,
  host,
  allowedOrigins: process.env.COMPANION_APP_ORIGIN
    ? [process.env.COMPANION_APP_ORIGIN]
    : undefined,
  runtimeEndpoints: {
    ...(process.env.COMPANION_OLLAMA_ENDPOINT
      ? { ollama: process.env.COMPANION_OLLAMA_ENDPOINT }
      : {}),
    ...(process.env.COMPANION_LLAMACPP_ENDPOINT
      ? { llamacpp: process.env.COMPANION_LLAMACPP_ENDPOINT }
      : {}),
    ...(process.env.COMPANION_OPENAI_ENDPOINT
      ? { openai_compatible: process.env.COMPANION_OPENAI_ENDPOINT }
      : {}),
  },
});
// A distinct listener means a Funnel request cannot fall through to local mode.
const remoteServer = process.env.NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN ? new CompanionServer({
  port: 41401,
  allowedOrigins: process.env.COMPANION_APP_ORIGIN ? [process.env.COMPANION_APP_ORIGIN] : [],
  remote: {
    origin: process.env.NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN,
    userLogin: process.env.COMPANION_TAILSCALE_USER || "",
    signingKey: process.env.COMPANION_REQUEST_SIGNING_KEY || "",
  },
  runtimeEndpoints: {
    ...(process.env.COMPANION_OLLAMA_ENDPOINT ? { ollama: process.env.COMPANION_OLLAMA_ENDPOINT } : {}),
    ...(process.env.COMPANION_LLAMACPP_ENDPOINT ? { llamacpp: process.env.COMPANION_LLAMACPP_ENDPOINT } : {}),
    ...(process.env.COMPANION_OPENAI_ENDPOINT ? { openai_compatible: process.env.COMPANION_OPENAI_ENDPOINT } : {}),
  },
}) : null;

async function main() {
  try {
    const info = await server.start();
    const remoteInfo = await remoteServer?.start();
    console.log("==================================================");
    console.log("  Forward Local AI Companion Running");
    console.log(`  Endpoint: http://${info.host}:${info.port}`);
    // Pairing code is shown only to an interactive local operator, never log collectors.
    if (process.stdout.isTTY)
      console.log(`  Pairing Secret (5 minutes): ${info.pairingSecret}`);
    if (remoteInfo) {
      console.log("  Private mesh backend: 127.0.0.1:41401 (Tailscale Serve only)");
      if (process.stdout.isTTY) console.log(`  Remote Pairing Secret (5 minutes): ${remoteInfo.pairingSecret}`);
    }
    console.log("==================================================");
    console.log("Press Ctrl+C to stop.");
  } catch {
    console.error(
      "Failed to start companion. Check local configuration and port availability.",
    );
    process.exit(1);
  }
}

main();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void Promise.all([server.stop(), remoteServer?.stop()]).then(() => process.exit(0));
  });
}
