#!/usr/bin/env node
// Synthetic transport smoke test. Never uses a real model, account, or database.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { CompanionServer } from "../src/companion/server.ts";

const origin = "http://localhost:3000";
const base = "http://127.0.0.1:41400";
const content = JSON.stringify({
  schema_version: 1,
  type: "add_task_checklist",
  task_handle: "fixture",
  items: ["Review fixture"],
});
const runtime = http.createServer((req, res) => {
  req.resume();
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    res.end(JSON.stringify({ models: [{ name: "fixture" }] }));
  else if (req.url === "/api/chat")
    res.end(JSON.stringify({ message: { content } }));
  else {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((resolve) => runtime.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${runtime.address().port}`;
const companion = new CompanionServer({
  allowedOrigins: [origin],
  runtimeEndpoints: { ollama: endpoint },
});
let page;
async function close() {
  await companion.stop();
  runtime.closeAllConnections();
  await new Promise((resolve) => runtime.close(resolve));
  if (page) {
    page.closeAllConnections();
    await new Promise((resolve) => page.close(resolve));
  }
}
try {
  const info = await companion.start();
  const post = (path, body, token) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  assert.equal((await fetch(base + "/health")).status, 200);
  const pairing = await (
    await post("/pair", { pairingSecret: info.pairingSecret })
  ).json();
  assert.equal(pairing.ok, true);
  assert.equal(
    (
      await (
        await post("/v1/status", { provider: "ollama" }, pairing.token)
      ).json()
    ).runtimeConnected,
    true,
  );
  const inferred = await (
    await post(
      "/v1/infer",
      {
        provider: "ollama",
        request: { model: "fixture", prompt: "Synthetic fixture" },
      },
      pairing.token,
    )
  ).json();
  assert.equal(inferred.content, content);
  assert.equal((await post("/unpair", {}, pairing.token)).status, 200);
  assert.equal(
    (await post("/v1/status", { provider: "ollama" }, pairing.token)).status,
    401,
  );
  console.log(
    "PASS: real HTTP health, pair, runtime status, inference, unpair, revoked-token rejection (synthetic runtime).",
  );

  if (process.argv.includes("--browser")) {
    // tsx already depends on esbuild. Bundle the actual browser client, not a mock.
    const require = createRequire(import.meta.url);
    const { build } = createRequire(require.resolve("tsx/package.json"))(
      "esbuild",
    );
    const bundle = await build({
      entryPoints: ["src/services/integrations/ai/companion-client.ts"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "companionClient",
      platform: "browser",
      define: { "process.env.NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN": "undefined" },
      plugins: [{
        name: "local-only-auth-boundary",
        setup(b) {
          b.onResolve({ filter: /remote-companion-actions$/ }, () => ({ path: "remote-auth", namespace: "fixture" }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export async function remoteSessionTicketAction(){throw Error('Remote auth is not part of the loopback smoke fixture')}" }));
        },
      }],
    });
    const fixture = JSON.stringify({
      enabled: true,
      companionUrl: base,
      endpoint,
      provider: "ollama",
      model: "fixture",
    });
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Companion transport smoke</title><h1>Companion transport smoke</h1><p>Synthetic fixture only. No account, database, or real model.</p><button id="run">Run browser smoke check</button><pre id="result">Ready</pre><script>${bundle.outputFiles[0].text}</script><script>
      document.getElementById('run').onclick = async () => {
        const result = document.getElementById('result'); result.textContent = 'Running';
        try {
          const config = ${fixture};
          if (!(await companionClient.checkCompanionHealth(config.companionUrl)).ok) throw Error('health');
          const paired = await companionClient.pairCompanion(config.companionUrl, ${JSON.stringify(info.pairingSecret)});
          if (!paired.ok) throw Error('pair'); config.pairingToken = paired.token;
          if (!(await companionClient.getCompanionStatus(config)).runtimeConnected) throw Error('status');
          const output = await companionClient.inferLocalContent(config, {model:'fixture',prompt:'Synthetic fixture',formatJson:true});
          if (JSON.parse(output).items[0] !== 'Review fixture') throw Error('inference');
          if (!(await companionClient.unpairCompanion(config.companionUrl, config.pairingToken)).ok) throw Error('unpair');
          if ((await companionClient.getCompanionStatus(config)).paired) throw Error('revocation');
          result.textContent = 'PASS: browser client health, CORS pairing, status, inference, unpair, and revoked-token rejection';
        } catch (error) { result.textContent = 'FAIL: ' + error.message; }
      };
    </script></html>`;
    page = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(html);
    });
    await new Promise((resolve, reject) => {
      page.once("error", reject);
      page.listen(3000, "127.0.0.1", resolve);
    });
    console.log(
      `Browser smoke ready at ${origin}; stop with Ctrl+C. Pairing fixture expires in five minutes.`,
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        void close().then(() => process.exit(0));
      });
    setTimeout(() => {
      void close();
    }, 5 * 60_000).unref();
  } else await close();
} catch {
  await close();
  console.error(
    "Smoke failed. Check that local ports 41400 and (browser mode) 3000 are free.",
  );
  process.exitCode = 1;
}
