# Local AI Companion and Proposal Trust Boundary

Authoritative Phase 10A implementation contract, updated 2026-08-31. This supersedes the earlier broad AI dispatcher description. No Phase 10B or later feature is implemented here.

## Supported scope

The only active AI write proposal is **add 1–20 checklist subtasks to one selected owner task**. Inference is optional. The model cannot call repositories, delete records, edit other tasks, change a course, execute code, fetch URLs, or use tools. Existing cloud dispatch is paused before egress; Notes AI assistance consequently returns an unavailable message, while ordinary Notes functionality remains unchanged. Cloud adapters and their historical consent schema remain available for a future reviewed integration, not as an alternate executor.

```text
Browser: explicit Generate(task ID, local provider/model)
  -> authenticated Next.js prepare action
  -> task repository: canonical bounded context + semantic revision
  -> signed DB request (one capability, owner, task, opaque handle, expiry)
  <- bounded model request (no DB ID, key, or auth token)
Browser -> 127.0.0.1:41400 companion -> configured local runtime
Browser <- untrusted inference text
  -> authenticated finalize(request ID, untrusted text)
  -> canonical reread + strict schema/capability/revision checks
  -> signed DB proposal creation
Browser <- persisted review (no domain changes)
Browser: separate explicit Apply(batch ID)
  -> authenticated server rereads immutable persisted proposal
  -> task repository -> signed narrow transaction RPC
  -> task subtasks + operation audit commit together
```

## Transport and browser support

The browser client lives in `src/services/integrations/ai/companion-client.ts` and rejects use without `window`. No Next.js Server Action fetches the companion. The browser URL is fixed to `http://127.0.0.1:41400`; runtime ports are never called from the browser.

| Environment | Support and evidence |
| --- | --- |
| Local browser on the companion PC | Supported. Real in-app browser smoke passed with the actual bundled browser client and synthetic runtime. |
| Hosted HTTPS Forward on the same PC | Designed to work in a supporting desktop browser after exact-origin configuration and local-network permission. HTTPS-origin CORS/preflight was tested over real HTTP; the actual deployed origin and permission prompt were **not** exercised. Deployment smoke remains required. |
| iPhone browser or installed PWA -> PC companion | **Unsupported.** Phone loopback points to the phone, not the PC. No LAN bridge or relay exists. Normal app features still work. |
| Desktop browser denying local-network permission, or policy-blocked browser | Local AI unavailable; do not disable browser security checks. |
| Hosted server or service worker -> companion | Not an application transport. Never forward requests through hosted server localhost. |

The client uses `mode: cors`, `credentials: omit`, `cache: no-store`, `redirect: error`, and `targetAddressSpace: loopback`. Literal loopback is intentionally used instead of public DNS. The daemon answers narrowly validated OPTIONS requests and the legacy private-network preflight header when requested. It does not use wildcard CORS or credentialed CORS. Initial health/pair requests allow 30 seconds for the browser permission prompt; inference is bounded separately.

Chrome's [Local Network Access documentation](https://developer.chrome.com/blog/local-network-access) describes the permission gate for public-site requests to loopback and the mixed-content handling. Browser versions, enterprise policy, CSP, and permissions can still block access. Treat hosted support as conditional; never claim CORS headers alone bypass browser policy. An outbound relay, trusted local TLS installation, or extension was not chosen because each adds security and lifecycle complexity beyond the accepted desktop-only scope.

## Companion network policy

The runner binds IPv4 `127.0.0.1:41400` only. Every request checks the socket peer and exact Host header. Defaults allow only `http://localhost:3000` and `http://127.0.0.1:3000`; setting `COMPANION_APP_ORIGIN` replaces them with one exact HTTPS origin. Wildcards, opaque/null origins, unexpected methods, paths, query strings, headers, and browser-selected targets are rejected.

| Runtime | Local default | Fixed operations |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434` | GET `/api/tags`, POST `/api/chat` |
| llama.cpp | `http://127.0.0.1:8080` | GET `/health`, GET `/v1/models`, POST `/v1/chat/completions` |
| Local OpenAI-compatible | `http://127.0.0.1:1234/v1` | GET `/v1/models`, POST `/v1/chat/completions` |

Only the local operator can configure alternative runtime endpoints with the three documented environment variables. They remain HTTP loopback root URLs (root or `/v1` for OpenAI-compatible); `localhost` is pinned to literal `127.0.0.1`. LAN/WAN/metadata/unspecified hosts, credentials, query parameters, fragments, and arbitrary paths are forbidden. The browser endpoint is only an equality assertion against that configuration. Adapters have no arbitrary method/header/path API, do not forward the companion token, never follow redirects, and cannot become a general localhost/LAN/WAN proxy.

Limits: 16 connections, one runtime operation at a time, 8 KiB headers, 96 KiB HTTP request body, 64 KiB generic inference prompt, 8 KiB system prompt, 4,096 maximum output tokens. The active checklist prompt has the stricter 32 KiB total data limit. Discovery has a 5-second deadline; inference has a 60-second deadline even with a caller cancellation signal. Runtime bodies are bounded to 1 MiB, extracted model content to 32,768 characters, and finalization to 32 KiB UTF-8. Streaming is disabled. Discovery exposes at most 100 validated model IDs. llama.cpp's loaded-model fallback requires an explicit models-route 404 after healthy `/health`; malformed/oversized/redirected discovery fails closed.

## Pairing and local trust

Startup generates 32 random bytes for a code that expires after five minutes. Only an interactive terminal displays it; noninteractive logs do not. The code is not taken from an environment variable. Pairing sends it in a JSON body over loopback, never a URL. There are at most ten pairing attempts per minute.

A successful pair issues a random 32-byte bearer token, bound to the exact origin, valid for 15 minutes. There is one active session: re-pair revokes the prior token; unpair or daemon restart revokes access. Browser storage is module memory only, never localStorage, cookies, or server preferences. Reload requires pairing again. Re-enter settings/reconnect if needed; after code expiry, restart for a fresh code. Failed unpair reports that the operator must stop the daemon for immediate revocation. Revocation is rechecked before returning runtime results. Cancellation aborts inference on the daemon connection closing; the runtime may not immediately release GPU resources.

Origin is a browser isolation check, not proof of identity for arbitrary local processes. Pairing possession is the local authentication boundary. Local malware, a compromised allowed origin/XSS, a compromised model runtime, or a compromised server is outside the protection of this bridge. The operator must run an inference-only runtime without external tool execution. This companion cannot sandbox a separately installed model server.

## Trusted proposal provenance and RLS

Migration `20260831100000_ai_trust_boundary.sql` introduces:

- Owner-readable `ai_requests`, with no direct authenticated INSERT/UPDATE/DELETE.
- A unique request link on `operation_batches` and restrictive AI batch/step RLS policies. Browsers cannot create, alter, move, delete, or relabel trusted AI rows; non-AI capture operations retain their existing rules.
- Private `ai_private.signing_key` and verifier, inaccessible to `anon`/`authenticated`/PUBLIC.
- Narrow signed prepare, record, approve, and reject RPCs. Security-definer functions pin an empty search path and require both server HMAC authentication and matching `auth.uid()`.

The server uses the ordinary authenticated Supabase request client, **not** a service-role AI client. `AI_TRUST_SIGNING_KEY` is separate from Supabase credentials and companion pairing secrets. A command authenticates exact JSON, owner, operation, data, and a 60-second expiry. The DB checks the signature, expiry, owner, operation, and its own domain invariants. Proofs never appear in action responses or model requests. Missing/mismatched configuration fails closed.

Browser-relayed model text can be fabricated or altered. Finalization treats it as **untrusted staging input** and independently validates it against the server request before signing proposal creation. Provenance proves traversal of the controlled server validation pipeline, not hardware/model attestation or guaranteed model authorship. A syntactically valid checklist fabricated by the owner can become a reviewable proposal, but cannot acquire another capability, choose another entity, skip approval, or insert arbitrary trusted operation rows. Provider/model audit fields are selected routing metadata, not cryptographic inference evidence.

Historical AI batches without a valid new request link are quarantined from Apply. Broad legacy cloud actions return disabled before any provider call, preventing an alternate browser-context/operation-array bypass.

## Capability, context, and stale state

`CHECKLIST_CAPABILITY` in `trust-contract.ts` is the active provider-neutral descriptor. It specifies read fields, one-entity scope, proposal access, output type, limits, and its strict parser. The historical capability catalog grants nothing by default and is not execution authority.

Only task title (200 chars), description (8,000 chars), and up to 50 existing checklist titles (200 chars each) are read for inference. A cryptographically random task handle replaces database identity. Task text is JSON under `untrusted_data`, separate from server system instructions. No notes, course documents, attachments, URLs, calendar, wellness, or other tasks are available. Returned output must contain exactly numeric `schema_version: 1`, `type: add_task_checklist`, the matching handle, and 1–20 unique, nonblank, bounded item titles. Unknown keys/actions/handles, control characters, duplicate items, excessive text, tools, and malformed JSON fail closed. Prompt injection can influence suggested wording; it cannot change this enforced authority. Render proposals as text and let the user judge their content.

Preparation and finalization reread canonical state. At Apply, the DB locks the task and compares a semantic SHA-256 revision covering title, description, status, course relation, and child IDs/titles/statuses. Parent-lock triggers serialize checklist insert/update/delete against Apply. Unrelated priority, deadline, and timestamp updates do not invalidate this checklist-only action. Relevant changes cause a conflict and zero domain writes; terminal/deleted sources are unavailable. Requests/proposals expire five minutes after preparation; generate again after expiry. Request creation is capped at ten per owner per minute.

## Apply and atomic audit

`applyAiProposalAction(batchId)` loads owner-scoped persisted proposal data, reparses it, and signs its database canonical digest. SQL rechecks provenance, capability, one-step shape, target identity, permission mode, expiry, state, revision, and duplicates. Only `ask_before_changing` permits explicit Apply; `suggest_only` and reserved `trusted_automation` do not. One SQL transaction creates the checklist children and commits the audit/result IDs. Any domain or audit failure rolls back both, including partial child insertion. Successful re-approval returns already applied without duplicate tasks. Lost HTTP responses can leave the client uncertain; reread/retry by ID resolves state safely.

No AI undo is implemented: audit metadata explicitly records `undo_supported: false`. Manual task editing/deletion remains available. No generic SQL/repository dispatch or multi-domain action array exists. Model providers never call mutation code.

## Configuration and activation

1. Apply repository migrations to an isolated test database first, then deploy the reviewed migration with the normal database administrator workflow. No production database was changed by this task.
2. Generate a new 32-byte secret with a secure random generator and keep its 64-character hexadecimal encoding in the server secret manager as `AI_TRUST_SIGNING_KEY`. Never prefix it `NEXT_PUBLIC_`, put it in a prompt, commit it, or reuse a Supabase/service-role/pairing key.
3. Through a privileged, non-browser application maintenance connection, insert the matching bytes into `ai_private.signing_key`. Use a bound parameter and do not record parameter values in logs:

   ```sql
   insert into ai_private.signing_key(singleton, secret)
   values (true, decode($1, 'hex'))
   on conflict (singleton) do update set secret = excluded.secret;
   ```

   This is an administrator provisioning example, not an RPC exposed to the app. Coordinate DB/server rotation; mismatch temporarily disables AI safely. Existing finalized records remain trusted; no signed proof is durably stored.
4. On the companion PC, install the project's dependencies and run an actual inference-only runtime on its configured loopback port. The standalone runner uses OS environment variables, not Next.js `.env.local`:

   ```powershell
   $env:COMPANION_APP_ORIGIN = 'https://your-exact-forward-host.example'
   pnpm companion
   ```

   Optional local operator overrides: `COMPANION_OLLAMA_ENDPOINT`, `COMPANION_LLAMACPP_ENDPOINT`, `COMPANION_OPENAI_ENDPOINT`. Port 41400 stays fixed. Use an interactive terminal to see the fresh code. Without the origin variable only the two localhost development origins are accepted.
5. Open Forward on that PC, explicitly check/pair in AI Settings, grant the browser's local-network permission if offered, and select a valid installed model. The saved cloud toggle does not enable the disabled legacy dispatch.

## Safe feature integration for Gemini

- Call `generateTaskChecklist(taskId)` from an explicitly labelled user action. It uses the memory-only paired session, prepares canonical context, runs local inference, and finalizes a proposal; it **never applies**.
- For a custom flow use `prepareTaskChecklistAction`, browser `inferLocalContent`, and `finalizeTaskChecklistAction`. Do not manufacture context/handles or persist the pairing token. Disclose the exact fields/provider before sending; no implicit background generation.
- Show the persisted `ChecklistReview` as plain text. Reload with `reviewTaskChecklistAction`. A separate explicit Apply passes **only `batchId`** to `applyAiProposalAction`; Reject uses `rejectAiProposalAction`. Handle unavailable/conflict/expiry without automatic regeneration or application.
- Abort before finalization cancels transport; abandoned metadata expires. Do not claim cancellation revoked an already finalized proposal: reject it explicitly if needed.
- Course-document import, cloud dispatch, checklist edits, and other mutation types need a new narrow capability, canonical source/revision read, strict proposal schema, and a domain-specific atomic approval transaction. Do not reuse the legacy generic action dispatcher. No broad permissions are implied by this foundation.

## Verification and remaining deployment checks

Automated suites cover real loopback HTTP attacks, all three protocol adapters, origin/Host/token/expiry/revocation policy, response limits, cancellation, redirection, malformed output, schema/capability injection, canonical context, ID-only approval, and disabled cloud egress. `ai-trust.integration.test.ts` applies the **entire actual migration history** in PGlite PostgreSQL, then runs authenticated-role/RLS, private-key, forged-proof, owner, staleness, idempotency, permission, and injected domain/audit rollback tests. PGlite is not a live Supabase deployment or a multi-session race harness.

Reproduce transport smoke without personal data:

```powershell
pnpm companion:smoke
pnpm companion:smoke --browser
```

Browser mode requires free ports 3000 and 41400, serves a temporary synthetic page at localhost:3000, and bundles the actual browser client. Click **Run browser smoke check**. It auto-stops after five minutes; Ctrl+C stops it sooner. The fixture contains a disposable pairing code for its synthetic daemon only. Never serve this test harness publicly. The standalone `pnpm companion` entry point was also started and `/health` verified; captured output contained no pairing code.

Before activating production AI, verify the actual hosted HTTPS origin on the intended desktop browser, permission grant/denial, blocked origin, pairing/re-pair/unpair, real runtime offline/timeout behavior, and a real model producing a valid checklist. Use a disposable task to check separate review/Apply, source conflict, duplicate Apply, and direct authenticated REST/RPC forgery denial in the deployed database. Denied/unsupported browsers must remain unavailable; do not weaken their policy. Production secrets, hosted-browser permission flow, real models, and live Supabase were not tested here.

Validated proposal text and result IDs remain in the protected audit. Abandoned request metadata currently has no automatic retention job; existing cloud-history clearing does not clear it. No raw model envelopes, prompts, documents, pairing tokens, signing keys, or Supabase credentials are logged/persisted by this pipeline. These limitations do not authorize later roadmap features.

## Validation record (2026-08-31)

- `pnpm lint`: passed.
- `pnpm typecheck`: passed (`next typegen` and `tsc --noEmit`).
- `pnpm test`: 533 passed, 2 skipped; 62 files passed, 1 skipped. The skipped tests require a separately configured live Supabase RLS project.
- `pnpm build`: passed on Next.js 16.3.3, including route generation and TypeScript.
- `pnpm exec vitest run src/companion src/services/integrations/ai/companion-client.test.ts`: 56 passed across 4 files.
- `pnpm companion:smoke`: passed all real HTTP synthetic-runtime checks.
- `pnpm companion:smoke --browser`: actual in-app browser reported PASS for client health, CORS pairing, status, inference, unpair, and revoked-token rejection.
- `pnpm companion` plus `/health`: version 2.0.0 returned; no secret printed in captured noninteractive output. Temporary processes were stopped.
- `git diff --check`: passed. No production migration or secrets were installed.

One pre-existing notification test expected the dispatcher to count deliveries already created as deferred by its repository. Its assertion now checks zero newly deferred deliveries and exactly one persisted deferred push. Notification production code was unchanged.
