# Phase 10 AI Trust Architecture Final Report

Reviewed 2026-08-31, including preserved Gemini checkpoint `15493bc`.

## 1. Final Verdict

**PASS WITH NON-BLOCKING FINDINGS**

The scoped trust implementation and reviewed Gemini integration are ready for code review/merge. Production activation remains conditional on administrator provisioning and actual hosted-browser/live-runtime verification. Main was not merged.

## 2. Beginner-Friendly Summary

Previously, AI flows could rely on browser-authored context/proposals, and writes could be separated from their audit records. Gemini's course/checklist UI used those unsafe shortcuts. Hosted server localhost also cannot reach a user's PC.

Redline now prepares the selected task or uploaded text on the server, validates the model's answer, saves a protected review, and accepts only its ID when the user approves. Edits create a new review and invalidate the old one. Changes and audit records commit together. The browser talks directly to the paired companion on the same PC.

AI can propose checklist additions and a new course with weekly meetings. It cannot delete records, modify existing courses, run tools, access arbitrary data/networks, or act autonomously. Ordinary Redline works without AI. The operator still needs to provision migrations/signing keys and validate their actual deployment before enabling AI.

## 3. Architecture Before vs After

```text
Before: browser context -> model -> browser proposal -> separate domain/audit writes

After: explicit selection -> authenticated server reread/extraction
       -> scoped signed request -> browser -> paired companion -> local model
       -> untrusted output -> server validation -> immutable persisted review
       -> optional edit -> successor review (old ID rejected)
       -> explicit approval ID -> normal repository -> domain + audit transaction
```

## 4. Hosted Browser → Local Companion

- **LOCAL PC BROWSER: WORKS** in the real synthetic transport smoke. Companion must run on that PC; a real model acceptance check remains.
- **HOSTED REDLINE ON DESKTOP: WORKS CONDITIONALLY BY DESIGN; DEPLOYED ORIGIN NOT VERIFIED.** Browser calls fixed `http://127.0.0.1:41400`, using exact-origin pairing and browser local-network permission where required. Do not read this as a tested deployed-browser claim.
- **IPHONE/PWA → PC COMPANION: DOES NOT WORK.** Phone loopback is the phone. No relay or LAN listener was added. Normal mobile/PWA features remain independent of AI.

## 5. Companion Network Security

Arbitrary localhost proxy: **NO**. LAN proxy: **NO**. WAN proxy: **NO**. Daemon-owned loopback runtime roots, fixed provider routes, peer/Host/origin checks, no redirects, no arbitrary methods/headers/URLs, bounded concurrency/body/output, and deadlines constrain the bridge. A compromised separately installed runtime is outside the bridge's sandbox; run inference-only runtimes.

## 6. Pairing / Authentication

Fresh random pairing code expires after five minutes; ten attempts/minute. One random origin-bound token expires after 15 minutes. Re-pair, unpair, and restart revoke prior authority. Tokens live only in tab memory; reload requires re-pairing. No environment-supplied pairing code, browser token persistence, or secret in URLs. Signing keys never reach the model/browser.

## 7. Trusted Proposal Provenance

Ordinary authenticated clients cannot write trusted request, batch, or step rows. Narrow database RPCs require a server-only HMAC proof, matching authenticated owner, exact operation and expiry. Apply rereads the persisted proposal and verifies its digest. This proves controlled server validation, not model authorship or human attention. The owner browser can submit invented valid suggestion text but cannot add authority or manufacture trusted database rows directly.

## 8. Capability Enforcement

“Generate checklist for Task X” grants `taskChecklist.propose` with `task.readMinimal`: X's bounded saved title/description/existing checklist only; output is 1–20 new checklist titles. No other task, linked material, note, calendar, SQL, network tool, deletion, or direct write.

Course import grants `courseImport.propose` with `document.readSelectedText`: one selected text upload, one new course, at most seven weekly meetings. Source/model text cannot select another capability. Provider choice changes inference routing, not authority.

## 9. Trusted Context

Task ID → authenticated task-repository reread → bounded canonical fields/revision → random handle → model. Uploaded File → authenticated server UTF-8 extraction → immutable persisted normalized source/digest → reread → bounded prompt/random document handle → model. Extra browser source/capability/date fields are ignored or rejected. Database IDs and credentials are absent from model context.

## 10. Stale-State Protection

Checklist preparation/finalization/Apply check a semantic revision covering task and checklist state. Relevant edits conflict with zero writes. Course source is immutable and digest-checked; replacing a document creates a new request. Duplicate existing course codes conflict without overwrite. Both requests expire after five minutes. Editing either proposal creates a successor immutable batch and rejects the predecessor atomically.

## 11. Proposal → Review → Apply

Both UIs display persisted review data. Bounded user edits must first be saved as a new review; this does not apply them. A separate explicit approval passes only the new batch ID. Apply rechecks owner, request provenance, capability, state, expiry, permission, source and proposal digest. `suggest_only` and reserved `trusted_automation` cannot mutate. Rejection/cancellation does not claim that a completed write was undone.

## 12. Mutation / Audit Atomicity

Task and course repositories call domain-specific SQL transactions. All subtasks, or the course and every meeting, commit with their result IDs and audit state. Injected domain/audit failures roll back everything. Successful reapproval is idempotent. A lost HTTP response can leave the browser uncertain, but cannot create a split database/audit outcome; reread/retry by ID is safe. AI undo is explicitly unsupported.

## 13. Prompt Injection Protection

Source text remains untrusted data. Separating it from system instructions helps model behavior but is not the security boundary. Exact output schemas, opaque handles, capability checks, immutable provenance, RLS, signed RPCs and atomic domain validation enforce authority. Suggestions can still be wrong or contain unwanted wording; review is necessary. No tool, SQL, shell, filesystem or arbitrary-network executor exists.

## 14. Runtime Adapters

Ollama, llama.cpp and local OpenAI-compatible adapters all use fixed routes and validated loopback configuration. Automated protocol/security tests pass. Real HTTP smoke used a synthetic runtime. No paid API or live model run was performed.

## 15. Provider Neutrality

Application permissions and proposal validation are independent of provider. Future cloud adapters must use the same canonical-context/capability/proposal boundary plus reviewed consent. Legacy cloud dispatch, including Notes AI, remains disabled before egress. No new cloud provider was added.

## 16. Security Findings

| Severity | Files / problem / realistic scenario | Resolution |
| --- | --- | --- |
| High integrity risk | Legacy `ai-actions`, AI persistence and broad Apply accepted browser authority; crafted authenticated requests could bypass intended provenance. | Canonical reads, protected RLS, signed scoped RPCs, immutable reviews and ID-only Apply. |
| Medium | Gemini checklist/course generators and review components trusted browser context and sequential writes; malformed/forged proposals or partial writes could be reported as success. | Strict contracts, server extraction, successor reviews and atomic repository transactions. |
| Medium | Companion client/server/adapters could confuse hosted localhost with the PC or expose excessive routing authority. | Direct desktop-browser bridge, exact-origin expiring pairing, daemon-owned destinations, fixed routes and bounds. |
| Low | Gemini Home/palette/telemetry used duplicate/hardcoded counts and healthy statuses, misleading workload decisions. | Canonical counts, explicit unavailable/unchecked states and user-triggered local reachability checks. |
| Low | Notification planning and creation used different clocks; quiet-hour behavior/tests could vary at boundaries. | Narrow shared-instant port, deterministic opposite-wall-clock regression; preserved deferred status and every hardening control. |
| Non-blocking deployment | Real hosted permission flow, live Supabase, real models and native-dialog keyboard behavior were not established here. | Explicit activation/manual test checklist; no claim of production end-to-end verification. |
| Non-blocking privacy/lifecycle | Course source and proposal text are retained in protected audit storage; expiry is not deletion. | Documented and disclosed; no raw-source logging. Automatic cleanup deferred. |

## 17. Tests Added

Adversarial extraction/schema bounds, injected instructions, forbidden keys/actions/handles, server canonical reread, ignored browser metadata, source tampering, ID-only approval, cancellation/unpaired behavior, owner/RLS forgery denial, immutable edited reviews, expiry/permission checks, duplicate course conflict, idempotency and injected course/meeting/audit rollback. The PostgreSQL suite applies the complete actual migration history. Personality tests are retained. Notification quiet-hours now deliberately uses a wall clock different from its supplied evaluation instant.

## 18. Validation Results

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test`: **585 passed, 2 skipped**, 68 files passed / 1 skipped. Skipped cases require configured live Supabase.
- `pnpm build`: PASS, Next.js 16.3.3 production compilation, TypeScript and 24-page generation.
- `git diff --check`: PASS.
- Companion/client security: **56 passed** across 4 files.
- Notification and Blackboard notification regressions: **110 passed** across 9 files.
- PostgreSQL/extraction/schema subset: **41 passed**; course server/browser orchestration: **9 passed**.
- `pnpm companion:smoke`: PASS with real HTTP, synthetic runtime, pairing/inference/unpair/revocation.
- Earlier `44f1b89` actual browser-client transport smoke: PASS. Actual integrated React UI fixture verified checklist/course generation, edited reviews, failed Apply retention, course ID-only approval, hidden commands, truthful states and 390×844 layout. Server/model boundaries were stubbed. Close-button return focus passed; automated native-dialog Escape/Tab did not establish keyboard behavior and needs manual verification.

Temporary browser tabs, viewport overrides and test servers were cleaned up. No production migrations/secrets/data were changed.

## 19. Changes Made

Trust foundation: fixed browser/companion transport, signed canonical request/proposal pipeline, restrictive RLS, atomic checklist application and security tests. Integration: server text extraction, scoped course contract/repository/actions, immutable edited reviews, atomic course import migration, Gemini review/personality UI, accessible modal primitive, truthful telemetry, reduced motion, synthetic UI harness and detailed disposition documentation. New dependency requirements came from the foundation (`tsx`, development `PGlite`); the Gemini integration adds no package dependency.

## 20. Git

- Review branch: `codex/phase10a-trust-completion`.
- Starting hardened main: `1033efb54121fffb25e9b3889a01dd666ac8a0a8`.
- Trust foundation: `44f1b89`.
- Gemini preservation: `15493bc` on `backup/gemini-personality-ai-20260831`, based on `e83d97a`.
- Reviewed integration is the subsequent commit on the review branch; the completion message identifies its hash and final working-tree status.
- No main merge, blind cherry-pick, reset, discarded Gemini work or production deployment.

## 21. Remaining Limitations

Desktop-only local AI; conditional hosted-browser support. No live model/Supabase/hosted-origin acceptance test or multi-session race stress. No automatic source retention cleanup or AI undo. Course import supports UTF-8 TXT/MD/CSV/ICS only, creates new courses, and uses server start date/time zone with no meeting end date. No section/color import, existing-course reconciliation, PDF/DOCX/XLSX/OCR, cloud reactivation or autonomous execution. Keyboard dismissal/focus needs manual target-browser verification. Pairing code/token expiry requires re-pair/restart as documented.

## 22. Can Gemini Safely Build AI Features On Top Of This?

**YES**, within the two implemented contracts. Use `generateTaskChecklist(taskId)` / `generateCourseImport(file)`, persisted review actions, bounded revise actions, then separate ID-only `applyAiProposalAction` / `applyCourseImportAction`. New domains need separately reviewed capabilities and atomic approval paths. Never restore the rejected generic executors or browser-context authority.

## 23. Required Actions Before Merge

**NONE for code merge.** Before production activation, apply both migrations through the administrator workflow, provision matching private server/database signing keys, configure the exact hosted origin, and verify local-network permission, pairing, real-runtime generation, canonical review/Apply, stale/replay/RLS denial and dialog keyboard behavior in the actual deployment. These deployment prerequisites are not claimed complete.

## 24. Final Recommendation

**MERGE TO MAIN** after normal code review; do not activate production AI until the documented deployment checks pass. This is a recommendation only: main was not merged, and no later roadmap phase was started.

## Gemini Integration Disposition

**ACCEPTED UNCHANGED:** deterministic greeting/workload copy, exact hidden-command matching and personality tests (formatting only where needed).

**ACCEPTED WITH MODIFICATIONS:** personality overlays/Home, measured telemetry, motion/accessibility, checklist and course review UIs, server text extraction, and only the necessary notification shared-clock propagation.

**REJECTED AS STALE/COLLATERAL:** Gemini's stale service worker, dispatch route/test, notification actions, handmade Web Push client/tests, unconditional pending status, browser-context AI executors, unsafe sequential school Apply, and unnecessary ordinary `createCourse` API change. Hardened `1033efb` semantics remain authoritative.

**DEFERRED:** additional document formats/OCR, existing-course merge, AI undo/retention automation, cloud reactivation and live deployment acceptance checks.

See [Gemini Integration Review](GEMINI_INTEGRATION_REVIEW.md) for all 37 files and an explicit nine-file notification disposition table. Gemini's original work remains preserved at `15493bc`.
