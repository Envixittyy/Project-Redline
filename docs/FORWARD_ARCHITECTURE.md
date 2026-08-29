# Forward Architecture & Design System

Forward (internal project codename: Project Redline) is a private, single-user personal command center and academic operating system. The user-facing product name is **Forward** and the guiding philosophy is **“Be curious, not judgmental.”**

The fundamental operational loop is:

> Capture fast → organize automatically → show what matters → reduce decisions → keep automation reversible.

This document defines the authoritative architectural contracts, visual design foundations, data boundaries, and security triggers for all future phases. Phase-by-phase implementation sequencing is maintained in `docs/ROADMAP.md`.

---

## 1. Core Architectural Boundaries

- **Single-User Architecture:** Built exclusively for one person. Do not introduce multi-tenant isolation, organizations, team sharing, SaaS billing, or generic workflow engine abstractions.
- **Server-First Composition:** Next.js App Router pages default to Server Components. Small client boundaries (`"use client"`) are introduced only where browser interaction, local device state, or Web APIs require them.
- **Strict Domain Separation:**
  - `src/components/ui` owns domain-neutral visual and layout primitives.
  - `src/components/shell` owns application frame, navigation, and global trigger composition.
  - `src/features/<feature>` owns feature-specific UI, forms, and pure domain logic.
  - `src/services/<domain>` owns data persistence and repositories. Repositories authenticate every call via `src/services/supabase/request.ts`.
  - `src/services/integrations/<provider>` contains external-provider adapters, crypto boundaries, and format translation.
- **Untrusted Input Boundaries:** Model outputs, browser payloads, Server Action inputs, and external webhooks/feeds are untrusted and must be validated before domain consumption.
- **Security & RLS:** Supabase Row Level Security (RLS) is the security boundary. Application-level user ID filters are defense in depth.
- **Distinct Persistence Entities:** Tasks, task work sessions, native calendar events, external calendar mirrors, and Blackboard records remain strictly distinct persistence domains even when presented together on unified views.

---

## 2. Visual Identity & Liquid-Glass Design Direction

### Visual Atmosphere & Palette
Forward uses a **deep, dimensional blue visual identity**. The default dark aesthetic is dark, cool, and layered (slightly darker than modern streaming/cinematic interfaces):
- **Background (Level 0):** Very dark navy / blue-black (`oklch(13.5% 0.025 255)`).
- **Elevated Background (Level 1):** Dark navy-blue (`oklch(16.5% 0.028 255)`).
- **Primary Surfaces (Level 2):** Subtle translucent navy (`oklch(19.5% 0.03 255 / 76%)`) with backdrop blur.
- **Highlights & Accents:** Restrained electric/cobalt blue (`oklch(61% 0.225 255)`) for focus, active indicators, and selection.
- **Typography:** High-contrast cool white / soft white primary text (`oklch(96% 0.012 255)`), cool desaturated blue-gray secondary text (`oklch(74% 0.025 255)`), and muted tertiary text (`oklch(60% 0.025 255)`).
- **Semantic Statuses:** Success (emerald green), Warning (warm amber), Info (sky blue), Destructive/Error (crimson red). Destructive red is strictly reserved for errors and irreversible actions to maintain a calming, low-anxiety workspace.

### Liquid-Glass Primitives
Inspired by Apple's liquid-glass design language, Forward applies layered translucency to create visual hierarchy rather than making all elements uniformly transparent:
- **Translucent Glass:** Applied to floating navigation bars, modal dialog shells, command palettes, dropdown menus, and interactive overlays.
- **Solid / Opaque Surfaces:** Applied to content-dense writing surfaces (Markdown editor) and long task lists to guarantee high contrast and eliminate eye strain.
- **Glass Characteristics:** Layered backdrop blur (`18px – 24px`), subtle surface reflections, thin illuminated upper edge borders (`oklch(90% 0.025 255 / 12%)`), faint inner shadows, and soft ambient drop shadows.

### Depth Hierarchy
The interface is structured into six discrete depth planes:
- **Level 0 (Ambient Canvas):** Application viewport with subtle radial ambient gradients and soft blurred blue light sources.
- **Level 1 (Content Surfaces):** Main scrollable layout frames and dashboard backdrops.
- **Level 2 (Cards & Widgets):** Task rows, calendar containers, note list items, and dashboard cards.
- **Level 3 (Interactive Floating Controls):** Floating quick-action buttons, active tab indicators, and search triggers.
- **Level 4 (Popovers & Tooltips):** Dropdown selectors, date pickers, and context menus.
- **Level 5 (Modals & Command Surfaces):** Command palette (`Ctrl+K`), Universal Capture overlay (`Ctrl+Shift+Space`), task editor modal, and notification drawer.

### Motion System & Microinteractions
Motion in Forward is smooth, responsive, physically coherent, and spring-like:
- **Composited Primitives:** Motion uses GPU-composited `transform`, `opacity`, and CSS `filter`. Indiscriminate layout animation (`width`, `height`, `margin`) is prohibited.
- **Spring Curve:** Uses `--motion-spring` (`linear(0, 0.006, 0.025 2.8%, ... 1)`) for natural settles and `--motion-fast` (`140ms`) for crisp interaction feedback.
- **Microinteractions:** Button press compression (`scale(0.985)`), subtle card lift on hover, smooth checkbox completion morphing, and surface edge illumination on focus.
- **Accessibility & Reduced Motion:** `prefers-reduced-motion` and `data-motion="reduced"` clamp durations to instant/minimal transitions (`1ms – 80ms`) with zero spatial displacement.

### Performance & Mobile Accessibility
- Avoid excessive simultaneous `backdrop-filter` nodes on mobile viewports.
- Mobile iPhone Safari and standalone PWA support touch targets (minimum 44x44px), bottom safe-area insets (`env(safe-area-inset-bottom)`), and responsive floating bottom navigation.

---

## 3. Universal Capture & Reversible Operations

`src/features/capture/capture-domain.ts` and `src/features/operations/operation-domain.ts` govern capture lifecycle:

```text
CAPTURE → INTERPRET → PROPOSE → CONFIRM → COMMIT → UNDO
```

1. **Capture:** Raw input is stored immutably in `captures` table (text, pasted text, link, and future image/screenshot uploads).
2. **Interpret:** Deterministic parser extracts task title, due dates, and priority without requiring AI.
3. **Propose & Confirm:** User reviews editable proposal card before any database entity is created.
4. **Commit:** Single database transaction creates the Inbox task and records an operation batch.
5. **Undo:** Idempotent 10-minute undo window via server-authored inverse actions; refuses deletion if the task was modified or gained subtasks after creation.

---

## 4. Calendar, Tasks & Multi-Source Scheduling

### Multi-Source Projections
`src/features/calendar/calendar-source-contract.ts` defines five distinct calendar projections:
1. **Task Deadlines:** Due date / timed deadline markers. Clicking opens the task editor.
2. **Task Work Sessions:** Dedicated planned work blocks from `task_work_sessions`. A task may own multiple work sessions.
3. **Forward Native Events:** User-created calendar events (`source = 'life_os'`) with start/end instants.
4. **External Calendar Mirrors:** Read-only mirrored events from Google Calendar and future CalDAV providers.
5. **School Timetable Meetings:** Dynamic recurring class occurrences projected at read-time from `course_meetings`.

### Tasks are NOT Calendar Events
A task may carry a deadline, scheduled start/end, and multiple work sessions without becoming a `calendar_events` row. Dragging or rescheduling a task on the calendar updates task/session timestamps; it never creates or mutates calendar event records.

---

## 5. Deterministic Planning & Scheduling Engine (P8)

`src/features/planning/scheduler-contract.ts` defines the mathematical planning engine:
- **Inputs:** Fixed calendar commitments, protected time blocks, preferred work windows, task deadlines, estimated durations, priorities, earliest start times, splittability, break buffers, and minimum session lengths.
- **Engine Rules:** The core scheduler is 100% deterministic, testable, and pure. It operates without database or LLM dependencies, calculating optimal non-overlapping work sessions in available free-time slots.
- **UX Integration:** Powers "Plan My Day" and "What Should I Do Now?" interfaces. Proposals are presented for one-click user review before persisting to `task_work_sessions`.

---

## 6. Focus & Goldfish Mode (P9)

Goldfish Mode is an explicitly activated, reversible presentation filter:
- **Purpose:** Eliminates cognitive overload and backlog anxiety by isolating today's immediate commitments, hard deadlines, and current/next work session.
- **Zero Guilt Design:** Hides backlog counters, overdue warnings, and non-essential clutter.
- **Pure Presentation:** Filters data at the UI layer without altering, postponing, or deleting underlying task/calendar records.

---

## 7. School & Blackboard Ingestion Flow

### 7.1 Decision and exact boundary

Phase 7A uses **one owner-scoped Universal Capture proposal for each stable Blackboard `external_records` row**. Blackboard synchronization remains the only writer of provider data. A per-record, authenticated database reconciliation transaction updates the external mirror and creates or refreshes its capture proposal; only the existing capture confirmation transaction may create a native task.

To protect data integrity, Blackboard sync **never silently creates native application tasks**:

```text
encrypted iCal credential → DNS-pinned HTTPS fetch → defensive iCal parser
        ↓ normalized provider item; no task mutation
owner-scoped `external_records` mirror + semantic proposal revision
        ↓ authenticated reconciliation RPC; idempotent by external-record identity
immutable `captures` evidence → deterministic interpretation → `capture_proposals`
        ↓ optional deduplicated notification → `/inbox?proposal=<proposalId>`
explicit user review and confirmation
        ↓ extended `commit_capture_task` transaction
native Inbox task + external link + reversible operation batch
```

The fetch/parser layer cannot write `captures`, proposals, or tasks directly. The reconciliation RPC cannot create tasks. The capture commit RPC cannot fetch Blackboard. This separation makes the source mirror authoritative for what Blackboard currently says while keeping the user authoritative for native task creation.

### 7.2 Stable source identity and revisions

The logical source identity is the existing `external_records.id`, backed by the database uniqueness of `(account_id, external_uid)`. `account_id` scopes the private feed connection and the provider-supplied iCal `UID` is the stable remote identifier. Reconfiguration or a repeated sync must find the same account row rather than create a second logical source namespace.

The current parser can synthesize `fallback:<hash>` when `UID` is absent. That fallback includes mutable values such as the deadline and is therefore not safe proposal identity. Phase 7A must fail closed: fallback-identity rows remain source-aware external records, but they do not automatically materialize a task proposal. The user can still create a normal manual capture. Enabling fallback-derived proposals would require a separately reviewed identity rule based on observed provider evidence.

Keep two revisions with different purposes:

- `content_hash` remains the full sync/audit fingerprint used to detect any normalized source change.
- `proposal_revision` is a versioned SHA-256 digest of only task-relevant normalized fields: title, optional plain-text description, due precision/value, and course code. Provider timestamps and source URL changes are excluded so metadata churn cannot reopen a proposal or notify the user.

The canonical digest input uses sorted keys, explicit nulls, normalized Unicode/whitespace, UTC ISO instants, `YYYY-MM-DD` dates, and a schema version. A Phase 7A implementation must test the canonicalizer with fixtures; it must not use runtime-dependent object serialization as an undocumented identity contract.

### 7.3 Proposal identity and lifecycle

The first eligible source revision is materialized atomically as:

1. An immutable `captures` row containing a bounded plain-text snapshot of the normalized source item. It may use the existing `text` kind; generated origin is represented by the proposal's external-record relationship rather than a fake new media type.
2. A deterministic `capture_interpretations` row.
3. A `capture_proposals` `create_task` row linked to the external record and carrying the editable default task payload plus current `source_revision`.

There is exactly one external `create_task` proposal row for an external record. Its stable proposal ID and capture ID survive source refreshes. The existing stored statuses remain authoritative: `proposed` is unreviewed/actionable, UI “Dismissed” maps to `rejected`, `confirmed` is transaction-local, and `committed` is accepted. `captures.stage` may remain `proposed` when its proposal is dismissed; the UI must read proposal status rather than infer dismissal from capture stage alone.

Phase 7A does not persist partially edited form drafts. Source reconciliation may therefore replace the server-authored default payload while a proposal is unreviewed. The commit request contains the user's final edited values and is validated transactionally. This avoids field-level merge policy in this phase.

Each external proposal stores `source_revision` (latest materialized revision) and `reviewed_source_revision` (the revision last dismissed, committed, or explicitly acknowledged). A source is awaiting review when these values differ or when a new proposal has no reviewed revision.

### 7.4 Source update semantics

| Review state | Unchanged sync | Material source change | Missing source / same-revision return |
| --- | --- | --- | --- |
| Unreviewed `proposed` | Update only `last_seen_at`; do not touch the proposal or notify. | Refresh the same proposal row and default payload, advance `source_revision`, and keep it `proposed`. A stale review form cannot commit until refreshed. | `missing_since` disables confirmation without deleting the proposal. Returning clears `missing_since` and makes the same proposal actionable again; it does not create a new proposal or re-notify by itself. |
| Dismissed `rejected` | Remain dismissed. | If the new semantic revision differs from `reviewed_source_revision`, reopen the same row as `proposed`, refresh its defaults, and notify once for that revision. Metadata-only changes do not reopen it. | A same-revision return remains dismissed and silent. A materially changed return follows the material-change rule. |
| Accepted `committed` with native task | Leave both proposal and task unchanged. | Update the external mirror and `source_revision`, but never mutate the task or create a second proposal/task. The proposal becomes a source-divergence review item because `source_revision != reviewed_source_revision`; notify once and let the user open/edit the native task separately or acknowledge keeping it unchanged. | Missing or returning never deletes, completes, reschedules, or recreates the task. The source state is shown beside the committed proposal. |

Acknowledging an accepted-source change advances `reviewed_source_revision` without changing the task. Phase 7A does not add automatic “apply source changes to task” behavior; any such action would need its own explicit reversible task-update contract.

### 7.5 Task conversion contract

Extend the generic capture commit transaction rather than adding a Blackboard task repository or trigger. The transaction locks the capture, proposal, and linked external record; proves owner equality; requires an active `proposed` row; requires `proposal.source_revision = external_record.proposal_revision`; and refuses confirmation while the source is missing. A race with synchronization returns a refresh-required result instead of committing stale fields.

After server validation, the transaction creates exactly one task with this mapping:

| Task field | Phase 7A value |
| --- | --- |
| `title` | User-confirmed title, defaulting to `normalized_title`; 1–200 characters. |
| `description` | User-confirmed bounded plain text, defaulting to normalized iCal `DESCRIPTION` when present; otherwise null. Source URLs and HTML are not injected. |
| `status` / `priority` | `inbox` / `none`. |
| `due_date` | Source date for date-only precision, or the workspace-local calendar day derived from an exact `due_at`. |
| `due_at` | Exact source instant only when the feed supplied an unambiguous instant; otherwise null. |
| `scheduled_start`, `scheduled_end` | Null. A deadline is not personal work time. |
| `course_id` | User-confirmed owner-scoped course match, defaulting only from a known mapping or one unambiguous normalized match; otherwise null. |
| `client_operation_id` | The capture operation-batch ID, preserving create idempotency. |

The same transaction marks the proposal `committed`, sets `reviewed_source_revision`, writes `external_records.task_id` only if it is null, and records the source record/revision and confirmed task payload in the server-authored operation step. Provenance therefore remains in `external_records`, the proposal, and the operation batch; the task is still an ordinary native task. No `calendar_events` row is created.

### 7.6 Database-backed deduplication invariants

Four barriers are required and independent:

1. **External mirror:** `(account_id, external_uid)` permits one source row for a provider UID. Duplicate UIDs within one feed are collapsed before reconciliation.
2. **Proposal:** a partial unique constraint on `(user_id, external_record_id, action_type)` where `external_record_id is not null` permits one `create_task` proposal per source row across retries and revisions.
3. **Native task:** the commit RPC locks the external record, treats an existing `task_id` or committed proposal as an idempotent result, and never overwrites the link. A partial unique `(user_id, task_id)` constraint prevents one native task from being claimed by multiple external records.
4. **Notification:** `(user_id, dedupe_key)` remains one event per source/event-kind/semantic revision, and the Phase 4D delivery uniqueness remains one delivery per event/subscription/channel.

Consequently, repeated unchanged syncs can update observation timestamps but cannot create proposals, tasks, operation batches, notification events, or deliveries.

### 7.7 Notification integration

Blackboard proposal notifications use the approved Phase 4D candidate lifecycle. Their source identity is `blackboard_record/<externalRecordId>/<eventKind>` and their revision is `proposal_revision`. Initial readiness, reopened/changed proposal, and accepted-source divergence are distinct bounded event kinds. The trusted deep link is `/inbox?proposal=<proposalId>` and is passed through `safeDeepLink`; provider URLs never become push navigation targets.

The reconciliation transaction upserts the in-app event by deterministic dedupe key. The future dispatcher revalidates the external record, proposal status, proposal revision, preferences, and expiry before push. When a newer source revision supersedes an unsent event, the old event remains history but its pending delivery is suppressed. Dismissal or commitment also suppresses a pending “proposal ready” delivery. Date-only deadlines do not acquire an invented timed reminder.

Notification generation is state-driven, not sync-run-driven. Retrying a run or returning the same feed cannot notify again. Phase 7A defines this contract but does not implement Phase 4D dispatch or Phase 7B notification UI/delivery work.

### 7.8 Reversibility and deletion behavior

Acceptance uses the existing ten-minute capture undo operation. Undo remains idempotent and refuses deletion after the task changes or gains subtasks. For an external proposal, successful undo also relies on `external_records.task_id on delete set null`; the committed proposal, accepted revision, capture evidence, and undone operation batch remain as provenance. The same source revision is not automatically proposed again and cannot silently recreate the task. Creating a replacement later requires another explicit user action outside automatic reconciliation.

Source disappearance is always represented by `missing_since`, never deletion. Disconnecting Blackboard changes the integration-account status and preserves records/proposals. The proposal-to-external-record foreign key uses `on delete restrict`; an explicit operator data purge must remove dependent capture history deliberately rather than cascading away accepted provenance.

### 7.9 Existing iCal capability and temporal precision

The current safe path can receive iCal `UID`, `SUMMARY`, optional `DESCRIPTION`, optional `URL`, `CATEGORIES`, `DTSTART`, `DTEND`, and `LAST-MODIFIED`/`DTSTAMP`. It does not prove that an item is a Blackboard Assignment object and cannot provide grades, submission state, attachments, rubrics, full course content, or a stable assignment API identifier beyond iCal `UID`. Proposal copy must therefore call it a “Blackboard calendar item,” not assert that it is an assignment; conversion to a task is the user's classification decision.

Before proposals are enabled, the parser must preserve iCal value parameters and stop treating every date/time as UTC. The normalized rule is:

- a timed `DTEND` is the deadline instant, falling back to timed `DTSTART` when no end exists;
- an all-day interval uses `DTSTART` as `due_date`; if only an exclusive date `DTEND` exists, use the preceding calendar day;
- UTC values and valid `TZID` values may become `due_at`; floating or invalid-zone date-times remain unresolved and produce no default deadline until the user chooses one;
- a source without a usable date may still produce a title-only proposal when it has stable UID identity.

This parser hardening is part of the future Phase 7A implementation, not this documentation review. The existing simplistic `YYYYMMDD → 23:59:59.999Z` and offset-free `→ Z` behavior must not be used to populate native task deadlines.

### 7.10 Rich Blackboard content — future security gate

Authenticated Blackboard APIs, credentials beyond the private iCal URL, session/cookie extraction, undocumented endpoints, browser automation, and authenticated scraping are outside Phase 7A. The unused `announcements` table remains inert technical debt. A future richer-content proposal must identify a supported API and scope, credential and revocation model, SSRF/redirect behavior, least-privilege access, rate limits, retention, audit/redaction rules, and explicit consent in a separate Codex security review. It does not block safe iCal-derived proposals.

### 7.11 Database implications (documentation only — no migration in this review)

Phase 7A requires a separately reviewed migration; this architecture review writes no SQL. The conceptual changes are:

| Object | Required change |
| --- | --- |
| `external_records` | Add bounded nullable `normalized_description`, `proposal_revision`, nullable `due_date`, `due_precision` constrained to `none`, `date`, `instant`, or `unresolved`, and nullable owner-checked `course_id`; retain `due_at`, `content_hash`, `missing_since`, and `task_id`. Add an owner/relation trigger for account, course, and task IDs plus the partial task-link uniqueness. |
| `capture_proposals` | Add nullable owner-checked `external_record_id on delete restrict`, `source_revision`, `reviewed_source_revision`, bounded `source_snapshot jsonb`, `updated_at`, and the partial external-record/action uniqueness. The existing `payload` holds the current server-authored task defaults. Permit `rejected → proposed` only when reconciliation advances the source revision. |
| `tasks` | Add nullable owner-checked `course_id references courses on delete set null`; retain legacy free-text `course` for compatibility but do not dual-write it from Phase 7A. |
| RPCs | Add an authenticated security-invoker per-record reconciliation RPC and generic dismiss/acknowledge operations; extend `commit_capture_task` and external-aware undo atomically. Revoke from `public`/`anon`, grant only to `authenticated`, and derive the actor from `auth.uid()`. |
| Indexes | Add owner/status indexes for proposal review, external-record proposal revision/missing state, and task provenance lookups. Retain current external and notification uniqueness. |

All new foreign-key relationships require database owner-equality checks in addition to RLS. No trigger may create or update a task in response to an external-record write.

### 7.12 Implementation order and security boundary

1. Add the reviewed migration, constraints, owner triggers, RPC grants, and migration contract tests.
2. Harden iCal temporal parsing and add fixtures for UID, duplicate UID, date-only, UTC, `TZID`, floating time, missing fields, and fallback identity.
3. Add the pure semantic-revision and lifecycle planner with a complete state-transition matrix.
4. Reconcile each normalized record through the authenticated transaction and preserve the current missing-record behavior.
5. Extend Universal Capture reads/UI for external proposal review, dismiss, acknowledgement, stale-refresh, missing-source, and committed-divergence states.
6. Extend the generic commit/undo path and task/course repositories; prove that no Blackboard module imports or calls ordinary task mutations directly.
7. Integrate deduplicated notification candidates and deep links, then verify repeated and concurrent syncs, dismissal/reappearance, accepted-source changes, task deletion, and undo.

Normal synchronization, proposal review, commit, and undo use `requireAuthenticatedSupabase()` and RLS. No service-role client is permitted in those request paths. Feed credentials, raw feed URLs, provider URLs, subscription endpoints, and unbounded source copy are never returned in proposal or notification read models.

---

## 8. Notion Knowledge Integration (P5)

### 8.1 Decision and authority model

Phase 8B selects **Redline-authoritative synchronization with per-note selective Notion import**. It is not symmetric ownership and it does not attempt collaborative merge. Every link has one of two directions:

- `forward_to_notion`: Redline title/body changes may be pushed. A remote divergence is shown for review and is never imported or overwritten automatically.
- `selective_two_way`: the user has opted this note into two-way synchronization. A supported remote-only change may be imported when the Redline note has not changed since the common baseline. Simultaneous changes pause synchronization for explicit resolution.

The native `notes` row remains the operational source of truth and is always editable without Notion. Task/course relationships, attachment ownership, archive state, offline mutations, search, and normal Notes reads never depend on Notion. Disconnecting or losing Notion must not make Notes unavailable.

Only the Redline note title and Markdown body participate. Task/course relationships and attachments remain Redline-only. The Notion page title is initialized from the Redline title at export for discoverability but is Notion-owned display metadata thereafter; the synchronized Redline title is the first heading inside the managed content root. This prevents a non-transactional page-property update from being mistaken for an atomic content update.

### 8.2 Managed remote boundary and transformation contract

Each linked page contains one Forward-managed top-level toggle block. `notion_page_links.remote_root_block_id` identifies the active toggle by persistent block ID. Its label contains an exact versioned Forward link/operation marker; its first child is a `heading_1` carrying the Redline title and its remaining children are the body. Users may edit supported descendants of the active root. Content elsewhere on the Notion page is Notion-only, is excluded from fingerprints, and is never imported, moved, archived, or deleted by Forward.

The versioned canonical projection supports:

| Redline Markdown | Notion representation | Round-trip rule |
| --- | --- | --- |
| ATX headings `#` through `###` | `heading_1` through `heading_3` | Exact level; `####` through `######` are unsupported rather than flattened. |
| Paragraphs | `paragraph` | Plain text and supported inline annotations only. |
| Bullet lists | `bulleted_list_item` | Ordered child sequence, nesting to three levels. |
| Numbered lists | `numbered_list_item` | Ordered child sequence, nesting to three levels. |
| Markdown checklists | `to_do` | Checked state round-trips as literal Markdown; interactive Redline checklist UI remains deferred to Phase 12. |
| Links | Rich-text link | Only validated `https`, `http`, and `mailto` targets; unsafe or malformed schemes block synchronization. |
| Emphasis | Bold, italic, and strikethrough annotations | Nested combinations are canonicalized in a fixed annotation order. |
| Inline/fenced code | Code annotation / `code` block | Fenced code keeps text exactly; unsupported language labels use Notion `plain text` while retaining the Markdown language in the canonical snapshot. |
| Quotes | `quote` | One Markdown blockquote becomes one quote block; nested non-quote children are unsupported. |
| Attachments | No synchronized representation | Redline private attachments and Notion file/image/PDF blocks remain provider-local and are not copied or fingerprinted. |

HTML, tables, columns, databases/data sources, synced blocks, embeds, bookmarks, equations, callouts, toggles nested inside the managed root, child pages, media/file blocks, unsupported API block types, list nesting deeper than three levels, and any lossy rich-text construct are outside the round-trip subset. Unsupported local Markdown fails validation before any Notion request. Unsupported content inside the active remote root sets `unsupported_remote_content`, records bounded block IDs/types for explanation, and performs neither import nor push. The user must move it outside the managed root or convert it. This is intentionally fail-closed: arbitrary Notion content is never represented by a fake placeholder and is never silently deleted.

The converter produces a neutral canonical AST with normalized Unicode, `\n` line endings, explicit empty/null fields, ordered children, normalized safe links, and a converter version. SHA-256 is computed over version plus deterministic JSON encoding of that AST. Local Markdown and the equivalent Notion subtree therefore produce comparable semantic fingerprints without relying on provider serialization.

### 8.3 Persistent identity, revisions, and provenance

Stable link identity is the tuple of the existing owner-scoped `notes.id`, `integration_accounts.id`, Notion workspace ID, and Notion page ID. `remote_root_block_id` is the explicit pointer to the currently active content generation and changes only through the verified swap transaction; it is not a second logical page identity. Titles, URLs, search results, and content hashes are never identity. The current `NotionPageLink` type is only a cross-phase sketch; Phase 8 implementation must align it to the approved persisted contract rather than treating it as storage.

The provider revision is an opaque observation value built from the page ID/trash state/page `last_edited_time` plus the active root's recursively ordered block IDs, trash states, and `last_edited_time` values. It is useful for a fast unchanged check and stale-response rejection, but it is not correctness authority: page timestamps may also move when Notion-only content changes. Canonical managed-content fingerprints decide whether synchronized content changed.

For each link persist:

- `base_snapshot`, `base_local_fingerprint`, and `base_remote_fingerprint`: the last common title/body projection and the two canonical fingerprints accepted in one successful synchronization transaction;
- `last_observed_local_fingerprint` and `last_observed_remote_fingerprint`: what the latest completed comparison actually read;
- `last_pushed_fingerprint`: the verified remote fingerprint produced by Forward's latest completed write, used as explicit self-write provenance;
- `last_remote_revision`: the latest fully fetched opaque provider revision;
- `last_attempt_at`, `last_success_at`, status, and bounded safe error code;
- active/pending attempt and root IDs for crash recovery.

`base_*` advances only after a complete verified push, a complete atomic import, an unchanged/converged observation, or explicit conflict resolution. A fetch error, unsupported conversion, partial remote write, or stale comparison never advances it.

### 8.4 Exact change and loop-suppression algorithm

Every attempt locks or compare-and-swaps the owner-scoped link, reads the current note, fetches the complete active remote subtree, validates both projections, and computes:

```text
local_changed  = local_now_fingerprint  != base_local_fingerprint
remote_changed = remote_now_fingerprint != base_remote_fingerprint
```

The transition matrix is fixed:

| Local | Remote | Result |
| --- | --- | --- |
| unchanged | unchanged | Store the latest safe revision/observation time and remain `synced`. |
| changed | unchanged | Stage and verify an outbound generation, then advance both baselines. |
| unchanged | changed | In `selective_two_way`, import atomically; in `forward_to_notion`, set `remote_pending` and require an explicit choice. |
| changed | changed | If the two current canonical fingerprints are equal, treat them as independently converged and advance the baseline. Otherwise persist a conflict and stop. |

A remote revision change with an unchanged managed fingerprint is metadata/outside-root churn. A remote fingerprint equal to `last_pushed_fingerprint` is Forward's verified write. In both cases Forward updates observation metadata without importing or writing back. After a push, Forward re-reads the new active root and atomically records its actual fingerprint and revision with the unchanged local fingerprint. A later detector therefore sees neither side changed, even though Notion issued a new revision. After an import, the owner-checked transaction updates the note and the two baselines together; any note-update trigger that marks local work pending is overwritten in that same transaction. These are the loop-suppression rules—timestamps or webhook authorship alone are never used.

Changing the converter version invalidates comparison compatibility. Links enter `upgrade_review`; implementation must preview/re-baseline them explicitly and may not interpret a version change as user content.

### 8.5 Conflict persistence and resolution

When both fingerprints differ from their bases and from each other, synchronization creates or refreshes exactly one open `notion_sync_conflicts` row and sets the link to `conflict`. The row stores the last common snapshot, current Redline snapshot, current supported Notion snapshot, all three fingerprints, the remote revision, and timestamps. The ordinary note is not duplicated or overwritten. The future UI presents a three-way diff with exactly two resolution actions:

1. **Keep Redline:** re-fetch and prove the remote fingerprint/revision still matches the conflict, then use the safe outbound generation swap.
2. **Use Notion:** prove the local fingerprint still matches the conflict, update the note through an owner-checked transaction, and reset both baselines to the imported canonical projection.

The losing snapshot remains in the resolved conflict row for recovery/audit. Resolution records the selected action, resulting fingerprint, resolver, and time. If either side changed after the conflict snapshot, the action fails stale, refreshes the conflict, and asks the user again. Synchronization resumes only after the chosen content is verified and baseline advancement commits; there is no last-write-wins path.

### 8.6 Synchronization triggers

Phase 8B uses bounded pull-on-use plus best-effort outbound debounce:

- Every native note save, including offline replay, commits locally first and durably marks a linked note `local_pending`. Notion failure cannot fail or roll back the note save.
- After a successful 900 ms Notes autosave, a separate client request may start a five-second quiet-period outbound attempt. Navigating away can cancel that convenience request because the durable link state remains pending.
- Opening a linked note triggers reconciliation when its last attempt is older than 15 minutes. `Sync now` always performs one explicit per-note attempt.
- Workspace/application open may process at most 20 stale linked notes or 30 seconds of work, whichever comes first, and records remaining links as pending for a later open/manual run.
- There is no continuous browser polling, service-worker provider access, scheduled background worker, or cron dependency in Phase 8B.

Notion webhooks are deliberately rejected for the initial implementation. They are aggregated change signals that still require a full authenticated fetch and introduce a public verification, replay, ordering, subscription, and revocation boundary. For one user, bounded pull-on-use gives reliable reconciliation with much less infrastructure. A later webhook phase may only enqueue the same idempotent reconciliation path; it may not mutate notes from the webhook request.

### 8.7 Safe remote writes and idempotency

Notion block replacement is multi-request and non-transactional, so Forward never archives the current active root before a replacement is complete:

1. Create a `sync_runs` row and claim the account's single-active-run lease. Persist a UUID attempt ID on the link before calling Notion. A crashed run may be reclaimed only after its bounded lease expires; the replacement run must first reconcile any pending root marker.
2. Re-read the note and active root; stop if the expected baselines no longer apply.
3. Append a new top-level managed toggle whose exact marker contains link ID, converter version, and attempt ID. Append/chunk all converted children within current provider limits.
4. Read the staged root back and require its canonical fingerprint to equal the intended local fingerprint.
5. Re-read the old active root. If it changed during staging, keep it active, archive only the staged root when safe, and create a conflict.
6. In one owner-scoped compare-and-swap transaction, require the same note fingerprint and pending attempt, switch `remote_root_block_id` to the staged root, and advance the verified baselines/revision.
7. Only then archive the old root. If cleanup fails, the new root remains active and the old complete version remains recoverable; record `cleanup_pending` and retry cleanup idempotently.

This generation swap may briefly show two complete managed roots, but cannot leave the only remote copy half-deleted. The attempt marker lets a retry find and resume an already-created staged root after a lost response. Zero matches permits a retry after bounded observation delay; more than one match is `ambiguous_remote_generation` and requires review. The same mechanism covers update and conflict-resolution retries.

Initial export first reserves a unique link and attempt ID, then creates the page with the exact marker and initial managed root in the create request. If the create response is lost, bounded discovery may inspect pages created by the same connection/parent during that attempt and adopt only one exact link/attempt marker; it never matches by title. No match after the bounded recovery window becomes an error rather than an automatic second page. Database uniqueness on note and remote page, the active account run constraint, pending attempt compare-and-swap, and exact markers make export, update, import, reconnect, resolution, and duplicate execution idempotent.

### 8.8 Deletion, archival, movement, and disconnect

- **Redline archive:** set `local_archived` and pause synchronization. Do not archive or delete Notion content. The user may explicitly unlink or separately confirm archiving the Notion page.
- **Future hard local delete:** a live link uses `on delete restrict`; the user must unlink/retire the link first. Unlinking preserves both the note and remote page and records `retired_at`.
- **Notion page/root trashed or deleted:** set `remote_missing`, preserve the note and baseline/conflict history, and offer explicit recreate-or-unlink actions. Never recreate automatically.
- **Notion page moved:** page ID is stable, so continue after validating the workspace, account access, and active root parent; refresh the stored URL. Loss of access is not treated as deletion.
- **Notion page duplicated:** the duplicate has a different page ID and is ignored. Forward never adopts it because its copied title/marker/content resembles a link. Relinking requires explicit user confirmation and uniqueness checks.
- **Managed root moved, duplicated, or marker edited:** fail closed with `remote_structure_changed`; do not adopt a lookalike block or overwrite the page.
- **Disconnect or revoked access:** preserve link, snapshots, conflicts, and local editing. Mark the account/link `disconnected` or `attention`; reconnect only by the same owner and workspace/account identity. A 401/403 never triggers destructive cleanup or identity replacement.

Remote cascading deletion is never automatic. The only operation that trashes a Notion page is a separately confirmed user action that revalidates the exact stored page/account/root identity immediately before mutation.

### 8.9 Rate limits, failures, and recovery

Use the existing per-account active-run constraint rather than a general job system. The adapter limits itself to two requests per second per Notion account, chunks block requests within current Notion limits, applies a per-request timeout, and stops at the application-open run budget. HTTP 429 must honor `Retry-After`. Network errors, 408, 429, and 5xx use full-jitter exponential backoff with at most five attempts and a 60-second per-delay cap; an explicit `Retry-After` may extend a delay up to five minutes. Validation failures and 400/401/403/404 responses are permanent for that attempt; 401/403 mark attention/revoked and 404 triggers the remote-missing/access check.

Failures update only link/account/run error state with bounded safe codes. They never mutate or erase the local note, advance baselines, clear identity, report Notes as unsaved, or block later ordinary edits. A partial staged root is recovered by pending attempt/marker. A partial import is impossible because note update, provenance, conflict resolution, and baseline advancement are one database transaction.

### 8.10 Authentication and trust boundaries

Notion credentials reuse `integration_accounts.encrypted_credential` and the shared AES-256-GCM envelope in `src/services/integrations/credential.ts`; there is no separate `integration_credentials` table in the current repository. Tokens are selected/decrypted only in server-only provider code and are never returned by status/link reads. All normal link, sync, import, and resolution paths use `requireAuthenticatedSupabase()`, request-scoped cookies, RLS, owner filters, and owner-equality checks. Service-role access is not permitted.

Phase 8A must request only the Notion content capabilities required for the chosen parent/pages. If OAuth is used, state is random, stored only as a SHA-256 hash with encrypted verifier/material, scoped to owner/provider/expiry, and consumed once, following the reusable security lesson—not the data semantics—of Google Calendar. Token/configuration mutations require same-origin/CSRF protection. Integration-token setup has no fake OAuth flow.

Provider responses and Notion content are untrusted. Validate UUID identities, workspace/account association, page/root parentage, pagination bounds, block depth/count/size, Unicode, link schemes, and API version before conversion. Never render remote HTML, follow remote URLs during synchronization, expose signed Redline attachment URLs, or place provider error bodies/tokens in client-visible errors. Pin a tested Notion API version; a version upgrade requires converter fixtures and an explicit compatibility review.

### 8.11 Database implications (documentation only — no migration in this review)

Phase 8B requires a separately reviewed migration. This architecture review writes no SQL.

| Object | Purpose and exact contract |
| --- | --- |
| `integration_accounts` | Existing owner-scoped source of truth for the Notion connection and encrypted credential, status, sync state, last success, and safe error fields. Keep the existing `(user_id,provider)` uniqueness and owner/status indexes/RLS. Disconnect preserves the row. Active links restrict ordinary account deletion; an explicit full-user purge deletes conflicts, links, then the account in that order. |
| `notion_page_links` (new) | Owner-scoped source of truth for one note/page identity and current sync state. Fields: ID, owner, `account_id`, `note_id`, workspace/page/root IDs, remote URL, direction, converter version, base snapshot/fingerprints, last observed local/remote fingerprints, last pushed fingerprint, last remote revision, active/pending attempt/root IDs, status/error, attempt/success timestamps, `retired_at`, and timestamps. FKs: owner cascades only for an explicit full-user purge; account/note are `on delete restrict`. Partial unique `(user_id,note_id) where retired_at is null` and `(account_id,remote_page_id) where retired_at is null`; nonblank/UUID/status/direction/hash checks. Index `(user_id,status,last_attempt_at)`. RLS is owner-only, with database owner-equality checks for account and note. Retired rows retain provenance and no longer participate in sync. |
| `notion_sync_conflicts` (new) | Owner-scoped source of truth for unresolved divergence: durable, bounded last-common/local/remote title/body snapshots plus fingerprints, remote revision, open/resolved status, resolution/result fingerprint, resolver, and timestamps. FK to link is `on delete restrict` until explicit history purge. Partial unique one open conflict per link; index `(user_id,status,created_at desc)`. Owner-only RLS and link-owner enforcement. Losing content is retained after resolution; only explicit history/full-user purge deletes it. |
| `sync_runs` | Existing owner-scoped diagnostic/provenance record, not content or link truth. Reuse account FK (`on delete cascade` after links are removed), idempotency uniqueness, counts, status/error, and owner RLS/indexes. Add bounded `lease_expires_at` and an owner/account/status/lease claim rule so a crashed `running` row cannot block forever. A run may cover one explicit link or the bounded application-open batch. Completed runs retain history until explicit retention/full-user purge. No new queue table. |
| `sync_changes` | Existing owner-scoped audit evidence, not sync-state truth. Add nullable owner-checked `notion_page_link_id on delete set null` and bounded `details jsonb`; extend change types for `pushed`, `imported`, `conflict`, `unsupported`, `relinked`, and `skipped`. Preserve existing run FK cascade, owner RLS, and add `(notion_page_link_id,created_at desc)` for provenance. Do not store tokens, raw provider responses, or attachment URLs. Link retirement preserves audit rows; explicit run/history purge may delete them. |
| `notes` | Existing owner-scoped canonical content source with current RLS, note/task/course ownership checks, and indexes; add no sync identity columns. Add a lightweight after-update trigger that marks an active link `local_pending`; it performs no network access. The authenticated remote-import/resolution transaction updates the note and resets link baselines atomically, so this trigger cannot create an echo. Active links restrict future hard deletion until explicit retirement; current archive behavior remains non-destructive. Existing task/course/attachment relationships remain untouched. |
| RPCs | Add authenticated, security-invoker compare-and-swap operations for claim/finish/fail attempt, apply remote import, open/resolve conflict, retire/relink, and cleanup state. Revoke from `public`/`anon`, grant only `authenticated`, derive actor from `auth.uid()`, lock relevant rows, and require expected fingerprints/revisions/attempt IDs. Provider HTTP calls remain outside database transactions. |

Persisted link status values are exactly `linked`, `synced`, `local_pending`, `remote_pending`, `syncing`, `conflict`, `unsupported`, `upgrade_review`, `cleanup_pending`, `remote_missing`, `remote_structure_changed`, `local_archived`, `error`, `disconnected`, `attention`, and `retired`; direction is exactly `forward_to_notion` or `selective_two_way`. Conflict resolution is exactly `keep_redline` or `use_notion`. UI wording may be friendlier, but storage must not invent overlapping states.

### 8.12 Future UI contract and implementation order

The UI derives `not linked` from no active link and must represent: `linked` (baseline not established), `synced`, `local changes pending`, `remote changes pending`, `syncing`, `conflict`, `unsupported content`, `error/cleanup pending`, `remote missing`, `local archived`, and `disconnected/revoked`. Every linked-note surface names the side with unsynchronized changes, shows last successful sync separately from last attempt, and keeps the native note save indicator independent from Notion status.

Implementation order is fixed:

1. Add the reviewed schema/RLS/owner constraints/RPCs and migration contract tests.
2. Replace the sketch provider contract with server-only typed page/block reads, opaque revisions, trash/access state, request bounds, and staged-root operations.
3. Implement and fixture-test the versioned Markdown/Notion canonical AST and both fingerprints, including every unsupported case.
4. Implement pure transition planning for the complete four-state matrix, directions, converged edits, converter upgrades, and remote structure changes.
5. Implement staged generation export/update/recovery and exact-marker idempotency before enabling local autosave-triggered attempts.
6. Implement atomic import/conflict persistence/resolution and stale compare-and-swap tests.
7. Add bounded manual/note-open/application-open triggers and the complete UI state contract.
8. Verify repeated and concurrent sync, lost create/update responses, partial block writes, rate limiting, unsupported content, archive/delete/move/duplicate/revoke/reconnect, offline note replay, and that Notes works with Notion fully unavailable.

---

## 9. Local AI Companion & Cloud Privacy

### Local Companion Architecture (Transport & Security Undecided)
- **Product Requirement:** Local Companion support is a confirmed future requirement to leverage local models (Local Qwen, OpenAI-compatible local endpoints, and optional Ollama / LM Studio compatibility) when the user's computer is available.
- **Zero Cloud Dependence:** Redline is cloud-hosted and MUST continue functioning completely normally when the companion is offline, disconnected, or unavailable.
- **Security Invariants:** Secure pairing, key revocation, origin validation, and explicit permission boundaries remain mandatory requirements.
- **Transport Mechanism Undecided:** The specific transport architecture (e.g. browser loopback, WebSocket, WebRTC, relay server, localhost bridge, browser extension, or companion tunnel) is intentionally UNDECIDED and uncommitted at this stage.
- **Explicit Review Gate:** *Local Companion transport and security architecture requires Codex architectural review before implementation.*
- **Vision Worker Memory Policy:** On-demand wake, 60–180s idle timeout, and automatic memory unload on system pressure.

### Cloud AI Privacy Gate
- **Cloud Fallback Modes:** `off`, `ask_each_time` (default), `automatic_on_low_confidence`.
- **Explicit Privacy Gate:** Private tasks, notes, or uploaded screenshots/images are NEVER transferred to cloud LLMs without explicit, interactive user consent.

---

## 10. Notifications Architecture

- **In-App Notification Center:** Shell tray displaying unread/read state, timestamped alerts, and safe deep links.
- **Delivery Channels:** Web Push (VAPID) for desktop browsers and installed standalone iOS PWA.
- **Deduplication & Safety:** Deterministic dedupe keys (`${type}:${sourceId}:${revision}`), URL sanitization (`safeDeepLink`), and quiet hours suppression (`isQuietHours`).

---

## 11. Security Review Triggers (Codex Escalation)

Codex review is mandatory before merging changes to:
1. **Authentication, RLS & Session Boundaries:** Supabase Auth, SSR cookie refresh, or table RLS policies.
2. **Database Migrations & Triggers:** New tables, foreign key constraints, or owner backfill RPCs.
3. **SSRF & Network Fetch Defenses:** `safe-fetch.ts`, DNS pinning, IP classification, or OAuth redirect handlers.
4. **Cryptographic Storage & Keys:** AES-256-GCM credential envelopes and token encryption.
5. **Local Companion Transport & Security Architecture:** Transport protocol, pairing token exchanges, origin verification, and cloud data transfer consent gates.
6. **Two-Way Synchronization & Recurrence Semantics:** Notion two-way sync loop suppression, Google Calendar writeback, or recurring task data models.
