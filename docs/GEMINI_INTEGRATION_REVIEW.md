# Gemini Integration Review

Reviewed 2026-08-31. Gemini's complete uncommitted work was preserved before integration as commit `15493bc` on branch `backup/gemini-personality-ai-20260831`, based on stale commit `e83d97a`. That branch is clean. Hardened main remained `1033efb`; this work was performed on `codex/phase10a-trust-completion` and was not merged to main.

## Disposition of all 37 checkpoint files

### Accepted unchanged

- `src/features/home/personality-greeting.ts` and `.test.ts`: deterministic, time-zone-aware greeting and workload copy; no authority or health inference.
- `src/features/personality/hidden-commands.ts` and `.test.ts`: exact-match hidden commands and deterministic workload-only assessment. Formatting may differ; behavior and copy contracts are unchanged.

### Accepted with modifications

- `docs/ARCHITECTURE.md`, `docs/PERSONALITY.md`: corrected active trust scope, diagnostics claims, retention, limits, and validation evidence.
- `src/app/(workspace)/page.tsx`: retained greeting and telemetry, replaced overlapping array lengths with exact canonical owner task counts; failures degrade to “Workload unavailable.”
- `src/components/shell/command-palette.tsx`: retained exact hidden commands, replaced hardcoded assessment data with authenticated canonical reads; fixed duplicate keys and modal/focus behavior.
- `src/features/personality/about-redline-modal.tsx` and `.module.css`, `telemetry-modal.tsx` and `.module.css`: retained personality; replaced fabricated “connected/healthy/nominal” claims with measured/unchecked states and an explicit browser companion check. Native dialog, focus containment, Escape, safe-area sizing, and 44px controls added.
- `src/features/school/course-import-modal.tsx` and `.module.css`, `school-workspace.tsx`: retained text-file review UX and School entry point. Replaced browser extraction/context, browser-authored proposal Apply, and sequential writes with selected-file server extraction, persisted review, successor review for edits, ID-only approval, failure retention, disclosure, bounds, and responsive controls.
- `src/features/tasks/task-checklist-proposal.tsx` and `.module.css`, `task-editor.tsx`: retained review UI and Task entry point. Replaced browser task contents and per-item creation loops with canonical checklist generation, persisted review, successor review for edits, ID-only atomic Apply, cancellation/rejection, and truthful error states.
- `src/services/documents/text-extractor.ts` and `.test.ts`: retained TXT/MD/CSV/ICS intent but made extraction server-only, fatal UTF-8, non-truncating, extension/byte/character/context bounded, and adversarially tested. PDF/DOCX/XLSX/OCR remain unsupported.
- `src/styles/motion.css`: retained tactile primitives and added transform removal for reduced/off/preferred-reduced motion.

- `src/services/notifications/notification-dispatcher.ts`, `notification-repository.ts`, and `src/types/notification.ts`: accepted only the shared evaluation instant; retained every hardened-main security check and quiet-hour `deferred` creation. Stale file replacement and unconditional `pending` were rejected.

### Rejected as stale or collateral

- `public/sw.js`: Gemini's partial push-URL regex was weaker than hardened `safeNotificationUrl` and click-time revalidation.
- `src/app/api/notifications/dispatch/route.ts`: stale GET-session/old-auth structure; hardened POST-only session registry and constant-time authentication remain.
- `src/app/api/notifications/dispatch/route.test.ts`: only collateral end-of-file whitespace.
- `src/features/notifications/notification-actions.ts`: endpoint allowlist/minute-bucket edits were weaker or redundant with hardened endpoint and deduplication rules.
- `src/services/notifications/web-push-client.ts` and `.test.ts`: stale handmade cryptography and host-only allowlist were rejected; maintained `web-push`, port/credential/key/redirect/endpoint checks and broader hardened tests remain.
- `src/features/ai/ai-actions.ts`: Gemini's broad course extraction action was rejected. New course actions use server extraction and the narrow repository.
- `src/features/school/school-actions.ts`: browser-proposal and sequential course/meeting Apply were rejected.
- `src/services/courses/course-repository.ts`: Gemini's return-value change to ordinary `createCourse` was rejected; the reviewed result adds only the narrow atomic import RPC boundary.
- `src/services/integrations/ai/checklist-generator.ts` and `.test.ts`: duplicate direct model fetch, browser context, lax schema, and no provenance were rejected. `checklist-client`, trust contract, signed repository and SQL transaction replace it.
- `src/services/integrations/ai/course-importer.ts` and `.test.ts`: duplicate direct model fetch, browser document text, silent truncation, lax schema, and no trusted Apply were rejected. The reviewed course import contract/repository/actions/client replace it.

### Deferred

- PDF, DOCX, XLSX, OCR, scanned documents, existing-course merge/update, editable import start/end dates, course color/section import, AI undo, automatic source-retention cleanup, live multi-session stress, a real-model acceptance run, and deployed-origin permission testing.

## Trust disposition

Both supported flows now follow: explicit user action → authenticated prepare → canonical server read/extraction → bounded inference-only request → untrusted output → exact schema/capability/handle validation → protected persisted review → optional bounded edit as a new review → separate ID-only approval → normal domain repository → one SQL mutation/audit transaction.

The browser cannot insert/update/delete protected requests or trusted AI batches/steps, choose the canonical task fields, modify persisted course source, sign requests, change capabilities, or send actions to Apply. An authenticated owner browser can fabricate syntactically valid model text and can call its own approval endpoint; provenance proves server validation, not model or human attestation. Documents and model output can influence proposal text but have no tools, repository access, SQL, URLs, or extra capability. Checklist Apply rechecks the semantic task/checklist revision. Course source is immutable, digest-checked, time-limited, and creates only a new course; existing course codes conflict without overwrite. Mutations and audit results commit or roll back together.

## Notification disposition

| Gemini notification file | Final classification | Decision |
| --- | --- | --- |
| `public/sw.js` | REJECTED AS STALE/COLLATERAL | Keep hardened push and click URL validation and payload bounds. |
| dispatch `route.ts` | REJECTED AS STALE/COLLATERAL | Keep POST-only session route, registry and hardened auth. |
| dispatch `route.test.ts` | REJECTED AS STALE/COLLATERAL | Ignore EOF-only whitespace. |
| `notification-actions.ts` | REJECTED AS STALE/COLLATERAL | Keep hardened endpoint validation and deduplication. |
| `notification-dispatcher.ts` | ACCEPTED WITH MODIFICATIONS | Port only shared evaluation time across three planners. |
| `notification-repository.ts` | ACCEPTED WITH MODIFICATIONS | Use shared time for quiet hours, subscription expiry and delivery timestamp; preserve deferred status. |
| `web-push-client.ts` | REJECTED AS STALE/COLLATERAL | Keep maintained cryptography and stronger endpoint/redirect/key checks. |
| `web-push-client.test.ts` | REJECTED AS STALE/COLLATERAL | Keep hardened security tests. |
| `types/notification.ts` | ACCEPTED WITH MODIFICATIONS | Add only optional server evaluation time to creation input. |

Hardened notification behavior remains authoritative. The only necessary Gemini idea was one shared server evaluation instant. It is now propagated without porting stale files and is tested against a deliberately different wall clock. Quiet-hour Web Push creation remains `deferred`. All other notification modifications above are rejected.

## Validation

- Full suite: 585 passed, 2 skipped; 68 files passed, 1 skipped. The skipped cases require a configured live Supabase project.
- PostgreSQL trust/extraction/schema subset: 41 passed; server/browser orchestration subset: 9 passed.
- Notification/Blackboard-notification regression: 110 passed. Companion/client security: 56 passed.
- Lint, typecheck, and Next.js 16.3.3 production build passed.
- Browser: actual integrated review components on a synthetic localhost harness verified checklist generation/edit/new review/stale failure, course TXT upload/edit/new review/ID-only Apply, exact hidden commands, truthful telemetry, 390×844 no horizontal overflow, and 44px dialog buttons. Automated native-dialog keyboard events did not establish dismissal/focus behavior; keyboard behavior remains a manual deployment check. Server/model/database were intentionally stubbed; PostgreSQL transactions were verified separately.
- Companion real-HTTP/browser-client smoke remains the `44f1b89` result; no production account, database, secret, paid API, or real model was used.

The repository now contains no Gemini-created notification regression and no broad AI executor. Main was not merged.
