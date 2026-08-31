# Redline Trust Repair Pass 1

## Verdict

**PASS** — shared infrastructure certification only. This does not approve merging
the feature branch or re-enabling any School Intelligence capability.

Started from clean `9d63220838fb301c013a6b8c0b932e35052c3939` on
`codex/school-intelligence-trust-repair`. Required repository/review documents,
Phase 10A checklist/Course transactions, and local Next.js security guidance were
read. Completed 2026-09-01. No paid inference, production migration, push or merge.

## Review Authority

| Question | Answer | Evidence |
| --- | --- | --- |
| Can browser substitute authoritative Apply payload? | NO | Signed consumption data accepts exactly `batch_id`; extra payload/target/source/capability keys fail. Mutation values come from the persisted step and manifest. |
| Can review A authorize another capability? | NO | Approval signature operation and fixed consumer capability must match the stored capability. |
| Can review A authorize another source? | NO | Target comes from the immutable manifest; arbitrary Note IDs are rejected. |
| Are successor edits persisted exactly? | YES | Exact JSON values, including whitespace in text, persist without trimming, coercion or truncation. New batch/digest links to its predecessor. |
| Can stale canonical source Apply? | NO | Source records are locked and their current fingerprints recomputed before consumption. Missing/archived sources fail closed. |
| Can consumed review replay? | NO | Request/batch locks, terminal states, one pending review and transaction-bound consumption prevent a second mutation. |
| Does `suggest_only` block mutation? | YES | Only `ask_before_changing` is accepted. Deferred `trusted_automation` also fails. |

These answers are proved through the real shared functions with fixed, test-only
Note and Task consumers. They are not inferred only from unconditional denial.
Production RPC revocations and application containment are independently tested.

## Source Freshness

Preparation constructs its source manifest in SQL from authenticated canonical
records. Caller-selected IDs are selection requests, not proof of ownership or
freshness. Caller-supplied snapshots, fingerprints, owners, expiry and handles are
rejected. The server generates request ID, opaque handle, five-minute expiry and
authority digest. The two registered exemplars accept exactly one Note and build
context from its complete bounded title/body; no arbitrary browser context is used.

Private fingerprint readers are deliberately domain-specific:

| Reader | Canonical fingerprint input and behavior |
| --- | --- |
| `note` | ID, exact title/body, task/Course relationships, archive state and `updated_at`; row locked. Archived/deleted Notes unavailable. |
| `course_meetings` | Course identity/code/name/instructor/location/archive state plus every current meeting's ID, title, sorted unique weekdays, date/time/zone/location. Meetings sorted by ID, maximum 100. Parent Course lock shared with normal meeting insert/update/delete/reparenting. |
| `capture` | Immutable text/pasted-text identity/raw evidence plus current stage and interpretation/operation links. No file/image Capture accepted. |
| `course_material` | Material identity, Course, type, title, description, URL and Course archive state; owner-consistent rows locked. URL is fingerprint data only, never fetched. |
| `calendar_event` | Exact native target identity/content/interval/source metadata and `updated_at`. Legacy `academic_calendar` rows rejected because their title hashes do not establish import identity. |
| `external_calendar_event` | Provider/account/calendar/event identities, connection state, selection, provider revision/content hash, event content/interval/status/missing state. Missing/cancelled/disconnected sources unavailable. No credentials selected. |
| `blackboard_record` | Account/provider/UID identity, semantic and content revisions, canonical title/description/Course/deadline precision and missing state. Fallback UID identities rejected. |
| `prediction` | Current prediction state plus fingerprints of its Course/meetings and explicit material/Blackboard/native-calendar dependencies. Terminal or unavailable dependencies fail. This detects change, **not historical generation authenticity**. |

Manifests contain 1–8 unique references in deterministic order, with all IDs
resolved. The capability validator separately restricts allowed membership; a
fingerprint reader never grants a capability or expands context. Only the two
one-Note exemplars are registered in Pass 1. Academic import identity/last-import
baseline and prediction generation provenance remain Pass 2 product requirements;
no missing identity is invented or legacy row retroactively attested.

Digests use versioned PostgreSQL JSONB serialization, fixed UTC timestamp
formatting and SHA-256. Request authority binds immutable source manifest/context,
owner, capability, handle, provider/model, time zone, preparation time and expiry.
Review digest additionally binds batch ID, predecessor ID and exact validated
output. Mutable status is checked separately, not included in an immutable digest.
Fingerprint checks repeat at record, revision and consumption, including expiry
checks after waiting for source locks. No global revision counter was introduced.

## Successor Reviews

`ai_revise_scoped_proposal` verifies the signed command, rereads the owner request,
locks its canonical source and batch, verifies freshness and old review digest,
then strictly validates the new output before writing anything. The successor
references the same request, retaining owner/capability/source/provenance/expiry;
its predecessor is stored explicitly and may have only one successor. Creating B
and rejecting A occur in one transaction. Invalid edits leave A proposed.

Shared TypeScript validation helpers reject unknown keys, wrong types, control
characters, malformed Unicode, invalid calendar dates, excess arrays/text and
unsupported authority fields. The existing Note rewrite/action-item parsers use
them; SQL independently validates the same schemas. Unsupported time/URL/ID fields
are rejected rather than accepted and ignored. Other product output contracts are
not registered; this pass does not claim all legacy parsers were repaired.

## RPC / RLS

Two additive migrations extend existing `ai_scoped_requests`, `operation_batches`
and `operation_steps`; no parallel proposal store or generic executor was added.
Legacy requests remain unversioned and cannot enter the new consumption path.
Source/proposal fields and terminal state transitions have database guards;
owner RLS and existing restrictive batch/step write policies remain intact.

The permissive bodies of `ai_create_scoped_request`, `ai_record_scoped_proposal`
and `ai_revise_scoped_proposal` are replaced, but their execute grants stay revoked.
`ai_read_scoped_review` remains an owner-RLS reader with added manifest, expiry,
digest and predecessor metadata. Signed rejection remains available, including
for legacy review cleanup. HMAC verification still uses the existing private key
and authenticated request identity; there is no service-role application client.

Future activation must use a **fixed, capability-specific SQL consumer**:

1. Server validates explicit approval intent and signs only the review ID.
2. Consumer hardcodes its capability and calls private `begin_scoped_apply`.
3. Begin verifies signature, owner, capability, request/batch status, expiry,
   manifest freshness, strict persisted output and immutable digests.
4. Consumer performs its fixed domain mutation using returned persisted authority.
5. It calls `finish_scoped_apply` in that **same transaction**, recording canonical
   result IDs, source/review/provider provenance and terminal consumption.

There is no independently committed claim endpoint, dynamic SQL, supplied callback
or browser action array. Claims bind PostgreSQL's transaction ID. A deferred
constraint aborts any transaction that leaves a claim unfinished. Domain failure,
audit failure or expired completion rolls back everything. Helpers have no
PUBLIC/anonymous/authenticated execute permission and use fixed empty search paths.

Preference reads and changes share a policy lock, including a previously absent
preference row. The existing presentation helper now matches Phase 10A policy by
denying `trusted_automation`. Cloud/provider settings do not authorize mutations.
Baseline checklist/text Course transactions were not replaced.

Local provider/model provenance is immutable and labelled `browser_relay`; it
proves validated relay data, not hardware or model attestation. Shared preparation
does not accept cloud providers in this pass. Cloud/binary transport and provenance
must be connected through their separately reviewed inference lifecycle later.

## Adversarial Tests

`scoped-review-foundation.integration.test.ts`: **54 tests**, actual full migration
chain, authenticated/foreign roles and real HMAC verification. It first verifies
production revocations, then grants only shared prepare/record/revise inside its
isolated database. Fixed mutation consumers exist only in `test_only` schema in
this test file; no test function is deployed or imported by application code.

Coverage includes all A–K requirements: substituted Apply payload/target; capability
mismatch; foreign sources/reviews; changed/deleted/archived source; predecessor
invalidation; malformed/oversized successors; sealed expired reviews; replay;
queued simultaneous consumption; direct trusted-table DML; suggest-only policy.
Additional cases cover failed mutation/audit and unfinished-claim rollback,
privileged immutable-field mistakes, forged signatures, exact edited whitespace,
canonical fingerprints in every reader, deterministic ordering, session timezone,
strict parser/SQL date/type/field parity, owner rejection and retained provenance.

PGlite uses one connection: simultaneous JavaScript calls are queued. SQL row locks
and transaction constraints are exercised, but no live multi-connection race test
is claimed. The existing 15 historical repair-defect reproductions remain clearly
labelled and are not counted as product activation evidence.

## Validation

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS, no warnings.
- `pnpm test`: **844 passed, 2 skipped**; **87 files passed, 1 skipped**.
- Focused trust/containment/contracts/privacy: **170 passed across 6 files**.
- New actual-migration foundation suite: **54 passed**.
- `pnpm build`: PASS, Next.js 16.3.3, 24 pages.
- `git diff --check`: PASS before commit.
- `pnpm install --frozen-lockfile`: PASS; dependencies and lockfile unchanged.
- PGlite migration/security tests: PASS.
- Live Supabase: not run; two environment-dependent tests skipped.
- No live provider, physical device, browser/PWA or production migration testing.

## Commit

Separate commit: `fix(ai): complete trusted review authority and freshness`.
Its hash is reported in the task's final response. Working tree cleanliness is
verified after committing. No merge or push is authorized or performed.

## Remaining Disabled Capabilities

Schedule and Blackboard screenshots; Academic Calendar import; assessment
prediction generation/conversion; Note summary/rewrite/action items; AI Quick
Capture; Daily Plan advice; material summary/study questions; Contextual Assistant.
Image transport and PDF/DOCX remain disabled. Baseline task checklist, reviewed
text Course import and manual workflows remain available.

## Recommendation for Pass 2

Port product adapters onto this foundation one bounded capability at a time.
For each, explicitly register its canonical source membership/minimized context
and strict output schema, implement a fixed domain consumer with canonical
semantics and audit, and test the real parser-to-SQL flow before any activation.
Academic import needs stable source-entry identity and a reviewed import baseline;
prediction conversion needs trusted generation provenance and source-state binding.
Existing quarantined Apply bodies must not be regranted as a shortcut. This pass
does not implement Pass 2 or change the prior feature-branch merge verdict.
