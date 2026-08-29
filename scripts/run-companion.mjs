#!/usr/bin/env node

/**
 * Forward Local AI Companion Runner
 * Starts the loopback companion daemon on 127.0.0.1:41400.
 */

import { CompanionServer } from "../src/companion/server.ts";

const port = Number(process.env.COMPANION_PORT) || 41400;
const host = "127.0.0.1";
const secret = process.env.COMPANION_PAIRING_SECRET;

const server = new CompanionServer({
  port,
  host,
  pairingSecret: secret,
});

async function main() {
  try {
    const info = await server.start();
    console.log("==================================================");
    console.log("  🚀 Forward Local AI Companion Running");
    console.log(`  🔗 Endpoint:       http://${info.host}:${info.port}`);
    console.log(`  🔑 Pairing Secret: ${info.pairingSecret}`);
    console.log("==================================================");
    console.log("Press Ctrl+C to stop.");
  } catch (err) {
    console.error("Failed to start companion:", err);
    process.exit(1);
  }
}

main();
