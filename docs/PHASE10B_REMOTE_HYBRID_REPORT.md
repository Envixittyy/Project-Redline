# Phase 10B Remote + Hybrid AI Report

Date: 2026-08-31. Scope: the user's explicit remote + hybrid assignment, not the historical image-ingestion placeholder.

## Final Verdict

**PASS WITH NON-BLOCKING FINDINGS** for implementation and synthetic verification. **Real remote deployment is not yet verified or configured.** No claim is made that an iPhone, outside-home connection, other laptop, paid provider account or real local model worked in this session. Those are activation prerequisites, not security checks silently waived.

The Phase 10 trust properties remain: canonical server-owned context, two narrow capabilities, immutable review/re-review, ID-only approval, stale checks and atomic mutation + audit. No later feature phase was started.

## Provider Architecture

Provider-neutral preparation/claim/inference/finalization serves both checklist and course import. Server preferences select Auto/Local/Gemini/OpenRouter; model text cannot select routes or authority. Local means the selected same-PC or remote-home-PC Companion transport. Cloud uses fixed server-only adapters. No provider receives an Apply API.

Key files:

- `src/services/integrations/ai/routing-contract.ts`, `inference-source.ts`, `inference-router.ts`: capability/privacy policy, canonical reconstruction and attempt orchestration.
- `src/services/integrations/ai/cloud-provider.ts`: Gemini/OpenRouter request bounds, models, fixed endpoints and normalized errors.
- `src/services/integrations/ai/remote-companion.ts`, `src/companion/request-ticket.ts`, `src/companion/server.ts`: authenticated exact-request tickets and separate private-mesh listener.
- `src/features/ai/routing-client.ts`, routing/ticket actions and the two feature clients: one shared browser flow and one-time cloud disclosure.
- `supabase/migrations/20260831120000_ai_remote_hybrid.sql`: private attempt state machine, one-use claims, provenance and per-capability preferences. Existing Apply implementations are unchanged.
- `.env.example`, `docs/REMOTE_HYBRID_AI.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`: blank configuration contract, setup and current phase boundaries.

No new production or development dependency and no lockfile change. Existing locked dependencies were installed for validation.

## Local AI

Ollama, llama.cpp and local OpenAI-compatible adapters remain. Runtime targets are daemon-owned loopback configuration; browser endpoint values can only assert that configuration. Same-PC transport stays `127.0.0.1:41400`. Bounded HTTP failure codes now distinguish unavailable infrastructure from malformed output, preventing an invalid model response from triggering cloud fallback.

Real HTTP and actual-browser synthetic runtime checks passed: health, pairing, CORS, runtime status, inference, unpair and revoked-token rejection. Real model inference and hosted-origin local-network permission behavior were not tested.

## Remote Local AI

Optional private HTTPS Tailscale Serve forwards only to the separate `127.0.0.1:41401` backend. The backend requires exact Serve login identity, allowed origin, an authenticated Forward server ticket and origin/owner/device-bound expiring pairing. Tickets bind the exact route/body/token/capability and expire in 60 seconds; replay is rejected. Inference-ticket issuance is one-use in the database. No LAN/public listener, generic proxy, direct runtime exposure or enterprise relay is added.

Read-only local Tailscale inspection found the CLI installed, `BackendState: NoState`, this device offline, no Serve configuration and no Funnel configuration. No network/account configuration was changed.

| Required scenario | Result and exact evidence |
| --- | --- |
| Same-PC desktop | **WORKS — synthetic runtime only.** Real HTTP and actual browser client checks passed. A real model/production app session remains untested. |
| Phone at home | **DOES NOT WORK in the current unconfigured setup.** Serve/tailnet is not active; physical iPhone/Safari/PWA test not run. |
| Phone away from home | **DOES NOT WORK in the current unconfigured setup.** No mobile-data/Tailscale/PWA test was run. |
| Other laptop | **DOES NOT WORK in the current unconfigured setup.** No paired second-device test was run. |
| PC offline | Synthetic network/unavailable errors verified: no mutation; a cloud offer is possible only with privacy permission and fresh consent. The physical PC was not powered off. |
| Local model offline | Synthetic unavailable/model-not-found/fetch-failure classification verified. Invalid output and revoked pairing stop instead of falling through. No installed model was stopped. |
| Cloud fallback | Mocked local → Gemini → optional OpenRouter chain passed, including separate confirmations, cancellation, privacy/mode revocation and terminal failure cases. No paid/live cloud request was made. |

Remote protocol tests used a real HTTP daemon and synthetic runtime with simulated Serve identity headers. They verify successful signed inference, unauthorized/no-identity clients, origin/preflight rejection, replay, device mismatch, expiry, revocation and arbitrary network targets. They **do not** verify Tailscale TLS/routing or an actual phone.

## Gemini

Server-only key and configured model; fixed generateContent endpoint, structured JSON, no tools, no redirects, bounded input/output and 30-second deadline. Uses the same authorized prompts and strict finalizers as local inference. Mocked success, policy rejection, rate limit, 5xx, invalid/truncated output, timeout and ambiguous network failure are covered. Live account/model compatibility remains unverified.

## OpenRouter

Server-only key and bounded specific `vendor/model` configuration; no endpoint override or automatic router alias. Requests disable provider fallback, require JSON support, deny data collection and request zero-data-retention-compatible routing. OpenRouter remains a cloud intermediary that may select an eligible downstream model host; no absolute privacy guarantee is claimed. Unsupported models/hosts fail closed. Mocked success, HTTP failures, tools, changed models, output bounds and network errors are covered. No live request was made.

## Auto Routing

Default conceptual order: selected local Companion → Gemini → optional OpenRouter. Preferred cloud can be reversed. Explicit modes do not switch provider. Cloud flags and capabilities default denied. Only infrastructure/provider availability failures permit another offer; malformed output, unauthorized/revoked pairing, stale source and Apply never trigger fallback. Ambiguous cloud network/timeout failures do not retry. Each source has a maximum of three attempts, no repeated provider and one active/successful attempt.

Changing mode/privacy after disclosure is rechecked at the server and atomic database claim. Switching to Local invalidates a pending cloud transfer. Consent cannot be replayed or transferred to a changed source/model. Cloud configuration missing at preparation sends nothing.

## Cloud Privacy

Cloud enablement, non-Off consent mode and explicit capability flags are required. The native confirmation discloses provider/model, purpose, fields, one selected source, bounded canonical bytes, expiry and terms. Each provider gets its own Send-once confirmation. Cancel produces no cloud egress. Selected course text is not an authorization to read arbitrary files; task context excludes unsaved edits, linked materials and unrelated notes. Unknown/future sensitive domains are denied.

Protected review/source audit retention is explicit: course text and validated proposal text remain persisted; routing rows contain metadata. Five-minute expiry stops execution, not retention. The old clear-history button clears only legacy history. Automatic cleanup is not implemented.

## Capability Security

Adversarial tests/review cover fixed outbound destinations, loopback binding, arbitrary URL/LAN rejection, exact CORS/origin, mesh identity plus Redline authorization, bounded tickets/responses, token revocation, replay and expiry; cloud one-use consent, current mode/privacy, source integrity and owner-only RLS; prompt injection, strict proposal shapes, stale apply, edited review invalidation and atomic rollback.

Local/remote output remains untrusted browser-relayed text. Provenance is informational, not hardware/model attestation or mutation permission. Cloud finalization cannot be supplied through the local browser finalizer. Old generic AI/cloud execution remains disabled. New network routing has no task/course mutation methods.

## Secrets

Gemini/OpenRouter keys and both signing keys are server-only. The new Companion key is separate from `AI_TRUST_SIGNING_KEY`, shared only by the app server and home-PC daemon. Only the configured remote origin is intentionally browser-visible. Raw provider bodies/errors, prompts and credentials are not logged. Pair codes are interactive-terminal-only; pairing tokens are browser-memory-only.

Tests use fixture secrets. A post-build scan of `.next/static` found **zero** bundles containing `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `COMPANION_REQUEST_SIGNING_KEY` or `AI_TRUST_SIGNING_KEY`. No real credentials were read, generated, provisioned or committed. This scan supplements server-only module boundaries; it is not a claim of exhaustive production secret auditing.

## Existing AI Feature Compatibility

Checklist and course clients request capabilities through the shared router without provider-specific business logic. Browser fixture checks confirmed canonical task preparation, review before Apply, edited checklist re-review, stale rejection, selected course-file review, course edit/re-review and ID-only course approval. A narrow-screen course review was inspected with no horizontal document overflow; this is not iOS/PWA certification.

Normal task/calendar/note/school functions remain independent of AI. Course imports remain TXT/MD/CSV/ICS only and never create tasks. Existing source-aware external calendars and Blackboard rules are unchanged. Next.js server-boundary guidance and React review informed the small settings/status changes and 44px controls; no broad UI redesign was undertaken.

## Tests

Final full suite: **683 passed, 2 skipped; 74 test files passed, 1 skipped**. The two skipped tests require an explicitly configured live Supabase test project. PGlite tests execute the complete migration history, including the new routing migration, and verify signed RPC/RLS behavior and existing atomic apply transactions.

Coverage includes router selection and fallback, both cloud adapters, per-domain privacy, consent cancellation/expiry/replay, mode revocation, provenance through revisions, canonical context, authenticated remote ticket issuance, real-HTTP remote pairing/inference/replay/revocation, SSRF/target rejection and existing checklist/course contracts. No paid/live provider traffic in automated tests.

## Validation

- `pnpm typecheck`: passed.
- `pnpm lint`: passed, no warnings.
- `pnpm test`: passed as counted above.
- `pnpm build`: passed, Next.js 16.3.3 production build.
- `git diff --check`: passed; Git emitted Windows LF/CRLF conversion notices only.
- `pnpm companion:smoke`: passed with a synthetic local runtime.
- `pnpm companion:smoke --browser`: actual browser transport passed.
- `node scripts/smoke-ai-review.mjs`: actual checklist/course UI fixture checks passed; server/model actions were explicitly synthetic.
- Read-only Tailscale status: not connected/configured; no physical remote test claimed.

## Required User Setup

Follow `docs/REMOTE_HYBRID_AI.md` for the full beginner-friendly sequence:

1. Apply the migration history to a test Supabase deployment and retain the matching Phase 10A server/database trust key.
2. Start a real local runtime and Companion; pair and test on the same PC first.
3. Connect Tailscale on the home PC and client devices. Keep the PC awake.
4. Configure the exact app/remote origins, a separate shared Companion signing key and exact Tailscale login. Rebuild the app when the public origin changes.
5. Use private **Serve** only, forwarding to `127.0.0.1:41401`; never Funnel, port forwarding or a raw runtime endpoint.
6. Pair the remote client with the remote startup code. Test home Wi-Fi, mobile data, other laptop and the installed iOS PWA separately.
7. Optionally configure server-only cloud keys/model IDs, then enable only the desired capability flags and consent mode. Review every transfer and every resulting proposal separately.

## Remaining Limitations

Real target devices, runtime/provider accounts, deployed Supabase and hosted-origin behavior require operator validation. One active pairing per listener, 15-minute sessions, five-minute startup codes and tab-memory tokens intentionally favor narrow security over convenience. Native consent UI is functional but not a presentation redesign. There is no automatic retry/recovery after ambiguous dispatch, no distributed transaction across provider delivery and proposal persistence, and no automatic retention cleanup. Crashes can leave an expired in-flight attempt or unshown proposal; they never trigger automatic Apply. No independent external review of this new phase was performed in this task.

## Git

Work is on **`codex/phase10b-remote-hybrid`**, based on `ed02ddf`. Changes remain uncommitted for review. No merge to main, push or PR was performed. The original worktree was clean; unrelated product features were not changed. The image/OCR assignment remains deferred, not implemented or silently removed.
