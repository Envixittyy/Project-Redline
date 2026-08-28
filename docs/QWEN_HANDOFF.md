# Qwen implementation handoff

Verified 2026-08-29. Read `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/FORWARD_ARCHITECTURE.md` before editing. This is a private, single-user app; do not add multi-tenant/commercial abstractions or advance phases opportunistically.

## 1. Current repository state

- Next.js 16.3.3 App Router, React 19.2.8, TypeScript, Tailwind 4, Supabase Auth/Postgres/RLS, PWA groundwork.
- Password auth, cookie sessions, protected workspace, Tasks, native Calendar, School courses/meetings, Notes/attachments, offline mutation queue, Blackboard calendar-feed sync, and notification groundwork exist.
- The linked hosted Supabase project has the same seven migrations as local, through `20260829000000_fix_phase1_relationship_owner_trigger.sql`.
- Normal repositories use request-scoped publishable-key clients; the service-role client is isolated to named maintenance/tests.
- User-facing identity is Forward. Internal `life_os` source values, storage keys, and Project Redline history remain intentionally stable.
- Authenticated browser CRUD was not rerun during this checkpoint because the available in-app browser had no session. The unauthenticated `/` → `/login` boundary rendered correctly with no browser console warnings/errors.
- Validation at handoff: ESLint passed, TypeScript passed, 119 tests passed, two credential-dependent RLS tests skipped, and the Next.js production build passed with Turbopack.
- `pnpm build` intentionally uses Next 16's default Turbopack path. Forced webpack hit a filesystem-snapshot defect while scanning absolute pnpm junctions in a nested `.claude` worktree; do not restore `--webpack` unless that upstream issue is fixed or the nested worktree is outside the project root.

## 2. Completed P0 work

- Reproduced Blackboard `ERR_INVALID_IP_ADDRESS`: Node requested the custom lookup result with `options.all === true`, but the pinned callback returned a scalar address/family instead of an array of address-family objects.
- Fixed the callback contract without weakening SSRF defenses.
- Added public/private/reserved IPv4, IPv6, mapped-address, multiple-answer, malformed-answer, and redirect coverage.
- Every redirect target is parsed, resolved, classified, and pinned before request.
- Blackboard sync persists source-aware external records only; it no longer creates or updates normal tasks.
- Feed configuration and errors stay server-side/redacted; the credential remains AES-256-GCM encrypted.
- Removed announcement UI/type exposure. The already-applied unused `announcements` table is technical debt, not permission to build announcement sync.

## 3. Canonical design system

- Tokens: `src/styles/tokens.css`
- Appearance catalog: `src/lib/theme/palettes.ts`
- Future preference contract: `src/lib/theme/contract.ts`
- Existing surface primitive: `src/components/ui/surface.tsx`
- Bootstrap/no-flash path: `src/components/appearance-init-script.tsx` and `src/lib/theme/appearance.ts`

Use semantic variables. Default direction is cool cobalt/cyan glass. Red is destructive/error. Do not hard-code a feature palette. The nine named themes are reserved contracts, not a request to implement all theme CSS in P1.

## 4. Canonical motion pattern

- `src/styles/motion.css`

Compose `.motion-enter` and `.motion-interactive`, then add feature-specific state only where it helps. Prefer opacity/transform/scale. Preserve `data-motion` and `prefers-reduced-motion`; do not animate layout indiscriminately.

## 5. Canonical CRUD/service patterns

- Task action validation/revalidation: `src/features/tasks/task-actions.ts`
- Owner-scoped repository mapping: `src/services/tasks/task-repository.ts`
- Source-aware native event writes: `src/services/calendar-events/calendar-event-repository.ts`
- Authentication boundary: `src/services/supabase/request.ts`
- Pure domain mapping: `src/features/calendar/calendar-domain.ts`

Server Actions are public endpoints: authenticate and validate every mutation. Keep Supabase clients and provider SDK values out of components.

## 6. Capture and AI actions

- Raw capture lifecycle: `src/features/capture/capture-domain.ts`
- Narrow action schema/parser: `src/services/integrations/ai/action-contract.ts`
- Permission decision: `src/services/integrations/ai/permission-contract.ts`
- Reversible batches: `src/features/operations/operation-domain.ts`

Flow is Capture → Interpret → Propose → Confirm → Commit → Undo. Default is Ask Before Changing. Model JSON is untrusted and never becomes SQL. Screenshot/image default is proposal review, not mutation.

## 7. Calendar rules

- Cross-phase source union: `src/features/calendar/calendar-source-contract.ts`
- Current read model: `src/features/calendar/calendar-domain.ts`

Keep task deadline, task work session, Forward native event, external fixed event, and Blackboard event distinct. One task may later have multiple work sessions. Never silently move external commitments or convert a Blackboard item to a task.

## 8. Notion role

- Contract: `src/services/integrations/notion/provider-contract.ts`

Forward is operational truth; Notion is optional knowledge/archive. Default Forward → Notion. Persist remote/local IDs and revisions, suppress loops with fingerprints, and never match by title.

## 9. External-calendar provider contract

- `src/services/integrations/calendar/provider-contract.ts`

Providers declare capabilities and read-only/read-write access. Do not assume Google, Microsoft, Apple/iCloud, and ICS/CalDAV feature parity. Codex owns OAuth/token/webhook security patterns.

## 10. Local/cloud AI provider contract

- `src/services/integrations/ai/provider-contract.ts`

Provider and model are configurable; text and vision roles are separate. The local vision worker wakes on demand, idles for 60–180 seconds, and unloads on timeout/pressure. Hosted app traffic reaches local AI through a paired browser-to-loopback companion, never server-to-localhost. Cloud fallback defaults to Ask Each Time; private images always require explicit transfer consent.

## 11. Scheduler constraints

- `src/features/planning/scheduler-contract.ts`

The engine must be deterministic and testable. Inputs include fixed commitments, protected time, work windows, deadline, duration, priority, earliest start, splitting/minimum session, breaks, and buffers. AI may recommend priority only. Return proposed sessions and explicit unscheduled reasons; never move fixed events.

## 12. Security boundaries that must not weaken

- Do not bypass auth/RLS or use service role in normal requests.
- Do not expose private feed URLs, tokens, encryption keys, OAuth secrets, or full sensitive URLs in logs.
- Keep Blackboard HTTPS-only public-address validation, DNS pinning, all-answer validation, and per-redirect revalidation.
- Do not whitelist vendors/institutions or hard-code their IPs.
- Do not build Blackboard announcements, grades, messages, documents, scraping, or task conversion.
- Do not give AI raw database/provider access or skip deterministic validation/confirmation.
- Do not silently upload private images to cloud AI.
- Do not let a hosted server call arbitrary user-supplied localhost endpoints.

## 13. Recommended implementation order

1. P1 visual shell/tokens/motion; migrate incrementally and verify mobile/reduced motion.
2. P2 Capture/Inbox using the pure state contract and reversible batch seam.
3. P3 work-session persistence and Calendar provider adapters behind capability checks.
4. P4 Blackboard calendar presentation/reliability only.
5. P5 Notion knowledge actions.
6. P6 AI provider/local companion/cloud-consent layer.
7. P7 image ingestion and lightweight vision worker.
8. P8 deterministic scheduler and “What Should I Do Now?” proposals.
9. P9 Focus/Goldfish presentation modes.
10. P10–P12 only in their named scope: routines/projects/goals/daily notes, views/reviews/analytics, then production polish.

Run lint, typecheck, relevant/full tests, and production build at every checkpoint. Read the repository’s installed Next.js 16 docs before Next-specific changes.

## 14. Reference-file index

| Pattern | Reference |
| --- | --- |
| Server auth | `src/services/supabase/request.ts` |
| Repository CRUD | `src/services/tasks/task-repository.ts` |
| Server actions | `src/features/tasks/task-actions.ts` |
| Calendar projection | `src/features/calendar/calendar-domain.ts` |
| Blackboard safe fetch | `src/services/integrations/blackboard/safe-fetch.ts` |
| Blackboard source sync | `src/services/integrations/blackboard/sync-domain.ts` |
| Design tokens | `src/styles/tokens.css` |
| Motion | `src/styles/motion.css` |
| Capture | `src/features/capture/capture-domain.ts` |
| AI schema/permission | `src/services/integrations/ai/action-contract.ts` |
| Undo batch | `src/features/operations/operation-domain.ts` |
| External calendar | `src/services/integrations/calendar/provider-contract.ts` |
| Notion | `src/services/integrations/notion/provider-contract.ts` |
| AI providers/vision/cloud | `src/services/integrations/ai/provider-contract.ts` |
| Scheduler | `src/features/planning/scheduler-contract.ts` |

## 15. Codex review checkpoints

Request Codex review after P1 tokens/motion, P2 capture commit/undo, each OAuth calendar provider, P4 Blackboard changes, P5 sync-loop handling, P6 companion/cloud transfer, P7 image privacy, P8 scheduler invariants, and any auth/RLS/migration/security-boundary change. Pause before merging if a checkpoint touches a boundary listed in section 12.
