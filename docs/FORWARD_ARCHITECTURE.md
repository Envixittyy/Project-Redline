# Forward architecture

Forward is a private, single-user personal command center. Project Redline remains an acceptable internal codename and existing internal identifiers are intentionally stable. The user-facing name is **Forward** and the tagline is **“Be curious, not judgmental.”**

The product loop is:

> Capture fast → organize automatically → show what matters → reduce decisions → keep automation reversible.

This document defines contracts for later phases. It does not authorize implementing those phases ahead of the roadmap.

## Core boundaries

- App Router pages compose features and default to Server Components.
- `src/features/<feature>` owns feature-specific UI and pure domain behavior.
- `src/components` owns reusable, domain-neutral interface primitives.
- `src/services/<domain>` owns normal persistence; repositories authenticate every call.
- `src/services/integrations/<provider>` contains external-provider adapters, credentials, and translation boundaries.
- Model/provider output, browser input, Server Action input, and webhook input are untrusted.
- Supabase RLS is the data security boundary. Application owner filters are defense in depth.
- Tasks, work sessions, native events, external events, and Blackboard records remain distinct persistence concepts even when Calendar renders them together.

## Design, theme, and motion

The locked direction is linear, cool, futuristic glass: blue-black/graphite/slate foundations, cobalt primary, cyan secondary, restrained violet, rare muted gold, and red primarily for error or destruction.

`src/styles/tokens.css` is the canonical semantic visual contract. It defines `background`, `surface`, `surface-raised`, `surface-glass`, `sidebar`, `panel`, `input`, `border`, `border-strong`, three text levels, accent states, focus, status colors, shadows, and glass controls. Compatibility aliases keep the current UI working while Qwen migrates feature CSS. Feature styles must not embed a permanent palette.

`src/lib/theme/contract.ts` reserves named presets and preference dimensions. Only mode and accent are currently exposed. Later controls must remain device-local, validate stored values, and apply root attributes before paint through the existing bootstrap. Do not read local storage during server render. Dark Reader-injected attributes are not an application hydration bug unless reproduced with extensions disabled.

`src/styles/motion.css` is the reference motion primitive. Prefer opacity and transforms; use the spring timing token for polish and avoid layout animation unless an interaction genuinely requires it. `data-motion="reduced" | "off"` and `prefers-reduced-motion` are both honored. Broad dialog, sheet, palette, list, calendar, focus, and Goldfish animation belongs to P1/P9.

## Universal capture

`src/features/capture/capture-domain.ts` separates immutable raw input from interpretation and committed objects. Supported raw kinds are text, pasted text, image, screenshot, photo, file, and link. The mandatory lifecycle is:

```text
CAPTURE → INTERPRET → PROPOSE → CONFIRM → COMMIT → UNDO
```

Basic text capture creates an Inbox capture without AI. P2 persists raw capture, interpretations, proposals, and operation-batch references in separate owner-scoped tables; inferred fields never overwrite raw evidence. The first shipped interpretation is deliberately deterministic: the first useful text line becomes an editable task proposal. Confirmation atomically creates an ordinary Inbox task plus a server-owned inverse. Undo is idempotent, expires after ten minutes, and refuses to remove a task that changed or gained children after commit.

## AI actions and permission

`src/services/integrations/ai/action-contract.ts` is the narrow model-output boundary. It accepts only the listed application actions, parses unknown JSON, validates deterministic fields, and returns typed proposals. It has no database client and no SQL escape hatch. Execution code must revalidate entity ownership and domain invariants at the application action/repository boundary.

`src/services/integrations/ai/permission-contract.ts` defines:

- `suggest_only`
- `ask_before_changing` — default
- `trusted_automation`

Image and screenshot ingestion always follows Analyze → Proposal → Review → Add All by default. “Trusted” does not bypass validation, RLS, external-provider capabilities, or cloud privacy consent.

`src/features/operations/operation-domain.ts` defines reversible batches. Commit the operation, its steps, and server-owned inverse data atomically. Undo is idempotent by batch ID and replays complete inverses in reverse order. Never trust inverse payloads supplied by an AI model or browser.

## Calendar domains

`src/features/calendar/calendar-source-contract.ts` names five distinct projections:

1. task deadline
2. task work session
3. Forward native event
4. external fixed event
5. Blackboard event

A task owns zero or more persisted work sessions in `task_work_sessions`. A deadline is not a work session, and existing single-schedule task fields remain compatibility-only. Fixed external commitments are not silently moved. Provider records retain provider and external IDs.

The existing `src/features/calendar/calendar-domain.ts` is the current reference read-model and rescheduling implementation. It keeps task deadlines, a task’s current scheduled interval, native events, and course meetings separate.

## External calendars

`src/services/integrations/calendar/provider-contract.ts` is capability-aware. Google, Microsoft, iCloud where feasible, and generic ICS/CalDAV adapters may support different subsets of listing, mutation, incremental sync, and change watching. The UI must check declared capability and access mode rather than infer parity.

P3 persists provider-neutral account, calendar, and event mirrors without claiming that any provider is connected. Calendar reads only connected and selected sources, preserves provider identity and revision, and treats every mirrored event as fixed. The connections page reports capabilities stored for a real account; it does not advertise unavailable actions or simulate OAuth.

OAuth callback state, tokens, refresh tokens, and webhooks are security-sensitive. Tokens stay encrypted server-side, callback state is bound to the authenticated session, redirect URIs are exact, refresh is serialized, logs are redacted, and external identity uses persistent provider IDs. Provider SDK objects do not escape adapters.

The first provider boundary is Google Calendar with read-only authorization. One-time state is owner-bound, hashed at rest, expires after ten minutes, and atomically consumed; the PKCE verifier and token envelope are AES-256-GCM encrypted. `APP_ORIGIN` supplies the exact callback origin rather than trusting request headers. Calendar discovery, token refresh, and event synchronization remain subsequent P3 work and must use the account’s declared capabilities.

## Blackboard

Blackboard is calendar-only and initially one-way. The private feed credential is AES-256-GCM encrypted at rest and never returned to the browser. Safe retrieval requires validated HTTPS, public DNS answers only, DNS pinning, manual revalidated redirects, time/size/content limits, and redacted diagnostics.

Synchronization writes source-aware `external_records`; it does not create or update ordinary tasks. Existing historical `task_id` links are preserved but not acted upon. The already-applied database migration contains an unused `announcements` table; treat it as technical debt, do not build announcement/grade/message/document synchronization, and remove it only through a separately reviewed additive migration.

## Notion

Forward is the operational system of record. Notion is an optional knowledge/archive destination, never a required backend. Default direction is Forward → Notion; selective two-way behavior is limited to explicit knowledge/page cases.

`src/services/integrations/notion/provider-contract.ts` requires persistent local/remote IDs, remote revision tracking, and an origin fingerprint for loop suppression. Never match by title. “Send/Open/Create/Attach Knowledge Page” actions belong to P5.

## Local and cloud AI

`src/services/integrations/ai/provider-contract.ts` separates provider, model, role, and capabilities. Text, vision, embeddings, tools, and structured output are optional capabilities; no model identity is hard-coded. Core capture, CRUD, Calendar, and planning inputs must remain useful with AI disabled.

The local vision role is separate from the text role. A P6/P7 companion should wake a lightweight worker on demand, keep it warm for a configurable 60–180 seconds, and unload it after idle or on memory pressure. Do not load another model when memory pressure exceeds the configured threshold.

A hosted deployment cannot reach the user’s `localhost`. The intended minimal path is browser → authenticated user-paired local companion. The companion binds to loopback by default, uses an ephemeral scoped pairing token, validates origin, exposes a narrow capability API, and never accepts arbitrary commands.

Cloud multimodal fallback is optional and provider-configurable. Modes are Off, Ask Each Time (default), and Automatic on Low Confidence. Private images always require explicit confirmation before cloud transfer regardless of mode. Do not assume any provider’s free tier is permanent.

## Deterministic planning

`src/features/planning/scheduler-contract.ts` defines fixed commitments, preferred windows, deadlines, duration, priority, earliest start, splitting, minimum session, breaks, buffers, protected time, and stable ordering. AI may suggest priority but does not place sessions directly.

The P8 scheduler must be a pure, versioned, deterministic engine over validated inputs. It returns proposals plus explicit unscheduled reasons. It cannot mutate fixed external commitments, cross protected time, or commit without the operation/permission flow.

## Focus and Goldfish Mode

Goldfish Mode is an explicitly activated, reversible presentation filter. It preserves all data, shows hard deadlines and fixed commitments, limits next actions, hides nonessential clutter, and never uses guilt language. A rare text-only “BELIEVE” easter egg is acceptable; copyrighted show artwork or heavy imitation is not.

## Security review triggers

Codex review is required before merging work that changes:

- auth/session/protected-route behavior or RLS;
- migrations, ownership triggers, or service-role use;
- URL fetch, DNS, redirects, webhook or OAuth behavior;
- encryption, credential storage, redaction, or local-companion pairing;
- AI schemas, mutation permissions, cloud image transfer, or operation undo;
- calendar source identity, external mutation, or deterministic scheduler rules.
