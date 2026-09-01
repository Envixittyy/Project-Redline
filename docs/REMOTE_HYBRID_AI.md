# Remote + Hybrid AI: setup and trust contract

Phase 10B, 2026-08-31. Adds inference routes only. See `PHASE10B_REMOTE_HYBRID_REPORT.md` for actual verification and `LOCAL_COMPANION_ARCHITECTURE.md` for the unchanged review/apply foundation.

## What is supported

- Auto, Local, Gemini and OpenRouter modes for task checklist proposals, selected-text course import, Schedule screenshots, and Blackboard Course-list screenshots. Pass 2 additionally supports Auto/Local assessment prediction generation using one explicitly selected saved syllabus and its Course, through same-PC or private-mesh local inference. Gemini/OpenRouter prediction egress remains disabled.
- Local means the selected Companion connection: same-PC loopback **or** the configured home-PC private-mesh connection. Auto does not guess which PC is yours or scan the LAN.
- Inference never applies changes. Review, edit/re-review, ID-only approval, stale checks and atomic domain-write/audit remain mandatory.
- TXT/MD/CSV/ICS are the only active document course formats. Pass 2C activates normalized PNG/JPEG/WebP input only for Schedule and Blackboard Course bootstrap. Academic Calendar screenshots, general OCR/Universal Capture, PDF/DOCX/XLSX, Notes/journal/Wellness AI, background mutation, shell, tools, filesystem access and browsing remain disabled.

## Request path

1. The authenticated server resolves one canonical task, one immutable selected text upload, or one explicitly selected image and its fixed capability from trusted code. Images are fully decoded and normalized to a trusted PNG source before disclosure. Browser text cannot choose a capability, provider endpoint or permission.
2. The server reads saved mode/privacy preferences and persists an owner-scoped inference attempt bound to the canonical payload digest, capability, provider/model, location and five-minute source expiry.
3. Local inference uses the existing paired browser transport. Remote-local text inference requires a signed exact-request ticket; Schedule and Blackboard image inference requires that same exact-body ticket discipline for both same-PC and remote-local transport. The deployed Next.js server never fetches a PC or LAN URL.
4. Cloud preparation returns a disclosure, not an upload. The user sees provider/model, purpose, field names, source count, bounded canonical request bytes, expiry and provider terms. Each Send-once action reconstructs source, rechecks privacy/freshness and atomically consumes that attempt before egress. Cancel sends nothing. The source body is not supplied back by the browser.
5. All output passes the strict capability parser and persisted review. Screenshot output cannot choose canonical targets. User edits create a server-sealed successor, and Apply accepts only its batch ID.

## Routing and failures

Auto defaults to local first; Gemini is the default preferred cloud provider. OpenRouter can be selected as preferred instead. The other cloud provider is offered only if secondary fallback is enabled. Each distinct cloud attempt needs its own disclosure and confirmation. Explicit Local never uses cloud; explicit Gemini/OpenRouter never switches provider. Cloud is off by default and both capability-specific flags default off.

Fallback allows local offline/unpaired, runtime/model unavailable, rate limit, provider HTTP 5xx, missing cloud configuration and local network/timeout failures. Pairing revocation/invalid authorization, malformed output, invalid endpoint, source changes and provider policy rejection stop the request. Cloud network/timeout results may be ambiguous after upload, so they do not automatically fall through to another provider. There are at most three attempts per source, no repeated provider and no parallel pending/successful attempt. A fallback never retries Apply.

Image disclosure has a stricter rule: local image failure, text-only configuration
or unknown modality never uploads to cloud automatically. A separate cloud image
disclosure must be prepared under the matching schedule, Blackboard or academic
calendar flag and explicitly consented before one exact provider request.

Status is deliberately limited: local health/model status is measured only on a user action; cloud settings show configured/not-configured and online status not checked, not fabricated health. Successful results expose provider, model, location, evidence and cloud request latency where measured. Local/remote latency is null. Local output is a browser relay, not cryptographic hardware/model attestation.

## Before enabling anything

1. Use this branch in a test deployment first. Run the full migration history, including `20260831120000_ai_remote_hybrid.sql`, through your normal Supabase migration workflow. No production database has been changed by this task. Back up before migration; do not reset an existing database.
2. Keep the Phase 10A `AI_TRUST_SIGNING_KEY` provisioning intact: the server and `ai_private.signing_key` must contain matching 32-byte keys. Follow the private-key instructions in `LOCAL_COMPANION_ARCHITECTURE.md`. This is not your Supabase service-role key.
3. Set `APP_ORIGIN` to the exact app origin, normally your HTTPS deployment, with no path or trailing slash. Sign in to Forward normally. The home-PC Companion must allow that exact origin.
4. Keep cloud disabled while checking local access. Missing optional cloud/remote keys must not prevent ordinary Forward features from working.

## Same-PC local setup

1. Start one installed local runtime and load the desired model. Leave its listener on loopback. Defaults are Ollama `http://127.0.0.1:11434`, llama.cpp `http://127.0.0.1:8080`, or a local OpenAI-compatible runtime `http://127.0.0.1:1234/v1`.
2. In an interactive PowerShell terminal in the repository, set `COMPANION_APP_ORIGIN` to your exact Forward origin, then run `pnpm companion`. The runner uses its OS environment; it does **not** load `.env.local`. If your runtime differs, set the corresponding `COMPANION_*_ENDPOINT` environment value before startup. Only validated loopback URLs and fixed runtime routes are accepted.
3. Open Forward on the same PC. In AI Settings select the same-PC connection, runtime and loaded model. The endpoint field must match the daemon's configured endpoint; it cannot redirect the daemon elsewhere. Pair using the local startup code within five minutes. Codes are shown only in an interactive terminal, not log collectors.
4. Check status and generate a small checklist from a saved task. Allow the browser's local-network permission if it asks. Review the proposal before Apply. Hosted-origin permissions/browser differences need a manual check on your deployment.

## Private home-PC access from phone or laptop

Tailscale is a separate prerequisite, not a new repository dependency. Install it on the home PC and each client, sign in to your private tailnet, and keep the home PC awake. On the phone, connect the Tailscale VPN before opening the hosted HTTPS Forward app/PWA. Loopback on an iPhone means the iPhone, **not** your PC.

1. Connect Tailscale and choose the home PC's stable HTTPS Serve name, shaped like `https://home-pc.your-tailnet.ts.net`. Use a personal, user-owned client identity matching your Tailscale login. Tagged/shared devices without that login identity fail closed; device sharing is not supported. Restrict tailnet access to the intended client devices with Tailscale's access policy.
2. Generate a **new, independent 32-byte random hexadecimal secret** using your password manager or a trusted cryptographic generator. Store it as `COMPANION_REQUEST_SIGNING_KEY` in the Next.js server secret environment and in the home-PC runner's private environment. Do not reuse the database trust-signing key, put it in browser code, paste it into this report, or commit it.
3. Set `NEXT_PUBLIC_COMPANION_REMOTE_ORIGIN` to the exact Serve HTTPS origin in the app build environment and in the home-PC runner environment. This hostname is intentionally public client configuration, not a secret. Set `COMPANION_TAILSCALE_USER` on the home PC to your exact Tailscale login. Set `COMPANION_APP_ORIGIN` there to the same origin as server `APP_ORIGIN`. Rebuild/redeploy the app when changing the public remote origin.
4. Run `pnpm companion` interactively on the home PC. With complete remote configuration it starts two **separate** loopback-only backends: local `127.0.0.1:41400` and private-mesh backend `127.0.0.1:41401`. Remote mode fails to start with incomplete/invalid configuration. The two listeners have separate pairing codes/sessions.
5. Check your existing Serve configuration first (`tailscale serve status`). When no conflicting service occupies the intended HTTPS port, configure **Tailscale Serve** to proxy to `http://127.0.0.1:41401`, for example `tailscale serve --bg http://127.0.0.1:41401`. Use the exact resulting HTTPS origin in step 3. Do not replace unrelated Serve routes. Tailscale documents Serve as private within the tailnet and describes its authenticated identity headers. [Official Serve guide](https://tailscale.com/docs/features/tailscale-serve).
6. Never use **Funnel**, router port forwarding, a public tunnel, a LAN/public Companion bind, or direct runtime-port forwarding. Do not point Serve at `41400`, Ollama, llama.cpp or LM Studio. The remote backend requires Serve's exact `Tailscale-User-Login`; Funnel requests lack the required identity and are rejected. Serve is the trusted local identity-header proxy; a privileged process already on the PC is outside this boundary.
7. On the connected phone/other laptop, sign in to Forward, choose the configured private home-PC connection in AI Settings and pair with the **remote** code. Generate a small review-only proposal. First test on home Wi-Fi; then disable Wi-Fi, reconnect the VPN over mobile data, and repeat. Test the installed iOS PWA separately from Safari. This physical-device sequence was **not** performed here.

### Revocation and expiry

One active pairing session per listener is deliberate for a single user. Re-pairing another device revokes the previous session on that listener. Tokens expire after 15 minutes, live only in browser memory, and are lost on reload; startup codes expire after five minutes. Restart the daemon for a fresh code. Stop it to revoke immediately, or use Unpair while connected. If Unpair cannot reach the PC, the UI warns that revocation was not confirmed. Remove a lost client from Tailscale too.

Every remote request requires an authenticated Forward server action to issue a 60-second signed ticket bound to owner, per-tab device ID, allowed origin, configured audience, exact route, exact body digest, token hash and narrow capability. Inference tickets are issued once per database attempt. Daemon nonce replay protection and pairing checks before/after inference reject replay or revoked delivery. Rotate the remote key on both ends and restart to invalidate tickets and sessions. No cloud key is needed on the home PC.

## Optional Gemini and OpenRouter

1. Obtain a provider key in your own account and choose a specific supported model. Add `GEMINI_API_KEY` + `GEMINI_MODEL`, and/or `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`, to **server-only** environment variables. For image authority also set the matching `GEMINI_MODEL_MODALITY` or `OPENROUTER_MODEL_MODALITY` to `vision`; `text`, missing and any other value reject image input. The app does not collect or display secrets.
2. Gemini model IDs must begin `gemini-`; OpenRouter model IDs must be a bounded `vendor/model` name. Arbitrary endpoints, router-auto and routing aliases are rejected. Verify availability and structured-JSON support for the chosen model in your account; automated tests use mocks, not paid calls.
3. Gemini uses the fixed `generativelanguage.googleapis.com` generateContent endpoint and an API-key header. OpenRouter uses its fixed chat-completions endpoint. No tools or browsing are enabled. Both have a 30-second whole-response deadline, bounded input/output and no redirects/retries.
4. OpenRouter requests JSON support, `allow_fallbacks: false`, `require_parameters: true`, `data_collection: "deny"` and `zdr: true`. It can still select an eligible downstream host for the chosen model; this does not make it local or establish an absolute privacy guarantee. If no eligible host/model supports these restrictions, the request fails. Read the provider's terms before sending private course/task text. [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [Gemini API terms](https://ai.google.dev/gemini-api/terms), [OpenRouter privacy policy](https://openrouter.ai/privacy).
5. In AI Settings, enable cloud offers, choose Ask each time, enable only the desired capability flags, select mode/preferred provider and optionally secondary fallback, then Save Preferences. Selecting a provider does not override a privacy denial. A separate confirmation is still required for every transfer.

## Data retention and remaining deployment checks

The routing audit stores metadata, not raw prompts/responses. Existing course source text and validated proposal text are intentionally persisted in the protected review audit. Five-minute expiry prevents execution; it does not erase records. The legacy clear-history button does not purge new routing/source/proposal rows. No automatic retention cleanup was added.

Claims precede egress, but network delivery and database finalization are not one distributed transaction. Crashes/ambiguous responses can leave an expired in-flight attempt or an unshown proposal; there is no silent retry or automatic Apply. Start a fresh user request after checking the situation. Key rotation, time synchronization, hosted Next.js/Supabase access, correct Serve configuration and a reachable awake home PC are operational prerequisites. Ordinary app editing remains independent of the AI route.

Before relying on remote use, test: real runtime/model; deployed migrations/key match; hosted-origin same-PC permissions; phone home Wi-Fi; phone mobile data; installed PWA; second laptop; home PC off; runtime off; Tailscale disconnected; pairing revoked; cloud disabled/domain denied; one-use fallback confirmation and Cancel. Do not treat a synthetic HTTP test as physical-device deployment approval.
