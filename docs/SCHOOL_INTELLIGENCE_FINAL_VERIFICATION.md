# Project Redline — Final School Intelligence Verification

## 1. Verdict

**FAIL — DO NOT MERGE**

Independent review of committed repair `e1224876f7be6febdc294bd47ac772db0cc2100a`.
The signed RPCs improve persistence and transactionality but do not implement the
required end-to-end authority contract. The final review contains the unsafe paths;
containment is not completion of the School Intelligence feature branch.

## 2. Merge Recommendation

**DO NOT MERGE**

## 3. Repository State

- Requested branch: `agent/gemini-school-repair`, clean at `e1224876f7be6febdc294bd47ac772db0cc2100a`.
- Starting review HEAD: `e1224876f7be6febdc294bd47ac772db0cc2100a`; `ebabedb` is its immediate parent.
- Task initially opened detached at `4c46f81`. Review was moved to the exact repair checkpoint in the task's isolated worktree.
- Review branch: `codex/school-intelligence-final-review`.
- Final HEAD/review commit: the separate `fix(ai): finalize school intelligence trust hardening` commit containing this report; its hash is in the final response.
- Working tree: final clean status checked after committing; original repair branch is unchanged.
- Reviewed all 34 files in `ebabedb..e122487`, the quarantine migration, relevant Phase 10A/10B contracts, domain consumers and schemas. All required repository documents were read.
- No merge, push, production migration, paid provider call or populated environment file.

## 4. SI-01 through SI-12 Reassessment

Statuses assess functional repair, not whether an unconditional denial prevents exploitation.

| ID | Previous severity | Status | Evidence and final disposition |
| --- | --- | --- | --- |
| SI-01 | BLOCKING | PARTIALLY FIXED | Protected `ai_scoped_requests`, signed creation and restricted batch/step RLS exist. Record/revise RPCs accept proposals without strict schema/capability/handle validation. Source snapshots lack canonical source IDs/revisions. New write paths now revoked and application entry points denied. |
| SI-02 | BLOCKING | STILL BLOCKING | Most Apply actions now accept a batch ID and read stored input, and SQL checks capability/digest. That improvement does not resolve missing source freshness, unvalidated edits, wrong target selection or semantic dedupe. All new Apply paths contained. |
| SI-03 | BLOCKING | STILL BLOCKING | Note Apply still takes a browser Note ID unbound to preparation; rewrite SQL reads `rewritten_body` but the parser emits `rewrittenBody`; action-items SQL reads `items` but the parser emits `actionItems`. Real rewrite fails and real action-items consumes review with zero Tasks. Summary insertion fed ordinary autosave, bypassing AI audit. Summary insertion disabled locally; Note and Quick Capture mutation paths quarantined. |
| SI-04 | BLOCKING | STILL BLOCKING | Prediction confirmation locks the row and creates/changes state atomically, but the server signs browser title/date/priority. No canonical-source freshness or created-entity/audit relationship. Substitution reproduced. Confirmation revoked and denied. |
| SI-05 | HIGH | PARTIALLY FIXED | Prior quarantine owner checks and no direct prediction DML remain. Repair confirmation has no durable created Task/Event provenance and uses a session GUC for the state transition. Final migration restores the non-confirming guard; owner dismissal survives. |
| SI-06 | HIGH | FIXED | All eleven consent groups (two baseline, nine additions) independently checked in repair SQL with each flag enabled alone. Unrelated permissions do not transfer. Final application/SQL gates deny every new domain even with all flags enabled. Existing Send-once/fallback separation retained. |
| SI-07 | HIGH | FIXED | Hardened decoder unchanged; 15 real image tests pass. Every provider adapter still refuses image-bearing input. No working vision transport is claimed. |
| SI-08 | HIGH | FIXED | PDF/DOCX remain disabled; UTF-8 text extraction and frozen dependency install pass. No parser dependency reintroduced. |
| SI-09 | HIGH | FIXED | Screenshot repository/SQL no longer writes mappings or manufactures external identity. Only canonical course creation/matching is attempted; mapping remains unresolved. Screenshot activation itself stays disabled. |
| SI-10 | HIGH | STILL BLOCKING | Calendar identity is only `lower(btrim(title))` hashed/truncated, shared across all owner sources. Two Holidays collapse; manual description is overwritten; old review can overwrite newer import. Reproduced in real SQL. Requires source-entry identity and last-import baseline, so Apply is revoked rather than changing to another unsafe hash. |
| SI-11 | HIGH | STILL BLOCKING | Parsers still coerce/truncate/default invalid data, ignore extra keys and weakly validate dates/IDs. Prediction context falls back to all Course materials and broad calendars. Daily-plan content remains browser-authored. Materials silently drops IDs beyond three. Contextual scope is one entity, but contracts/freshness remain incomplete. Contained. |
| SI-12 | MEDIUM | PARTIALLY FIXED | Repair introduced a compile error (`err` without catch), removed manual Capture refresh, ignored Note item selections/edits and append mode, and allowed failed syllabus revision to fall through to old review Apply. Compile error, refresh, unsafe summary insertion and failed-revision fallthrough fixed; dormant review controls still need a functional/accessibility review before activation. |

## 5. Proposal / Review Authority

For the **final contained state**, specifically the new capabilities:

- Can browser substitute Apply payload? **NO**: all new entry points fail before signing/writes and database execution is revoked. Submitted prediction conversion: **YES**, independently reproduced.
- Can unrelated review authorize mutation? **NO** after containment. Submitted SQL accepts a caller-selected Note without source binding; ordinary rewrite currently fails separately on its field mismatch, so this is not claimed as a successful end-to-end browser Note exploit.
- Can consumed review replay? **NO** after containment. Submitted Apply row locks/status checks also block repeated mutation for the same batch.
- Are review edits bound to exact persisted successor? **NO** as a complete working contract. The successor row is persisted and predecessor rejected, but revisions bypass strict validation and use discriminants rejected by subsequent readers. Note/Quick Capture successor editing is missing; UI edits are ignored in Note action items.
- Is stale source rejected? **NO** as a working freshness contract. Final denial rejects all requests, not specifically stale requests. Hashing immutable prompt text only proves that the snapshot did not change, not that canonical data is current.

The existing checklist and text Course import remain active with their original
signed context, strict contracts, successor review, permission, freshness and
atomic domain/audit checks. No provider choice expands authority.

## 6. Prediction Confirmation

- Can AI confirm automatically? **NO**; no model tool or automatic confirmation path.
- Can browser substitute Task/Event payload? **NO** finally; **YES** in submitted repair (server-signed browser draft).
- Can replay duplicate Task/Event? **NO**; submitted state checks reject confirmed/dismissed/superseded rows, and final confirmation is disabled.
- Can concurrent confirmation duplicate? **NO** with final denial. Submitted SQL `FOR UPDATE` serializes confirmation; PGlite queued calls produced one creation. This was not a live multi-connection PostgreSQL race test.
- Is mutation + prediction state atomic? **YES** in the submitted SQL function transaction, independently exercised; the function is now unavailable to clients.

Atomicity does not fix missing source freshness, provenance, payload review, or
timezone semantics. Task date can diverge from `due_at`; predicted local time is
assigned UTC. Event confirmation ignores predicted time and creates UTC all-day
boundaries. Historical predictions are not retroactively attested as safe sources.

## 7. Academic Calendar

Title-only identity is **unsafe and was not replaced with another inferred hash**.
It omits source identity and source-entry identity. Two distinct same-title events
collapse into one, even in the same proposal. Unchanged reimport finds that row,
but date changes blindly overwrite it and manual edits, and an older review can
overwrite a later import. A one-use batch prevents replay of that batch only;
it does not establish logical-event identity across requests. All-day values are
incorrectly built with UTC suffixes and inclusive `23:59:59` ends.

This requires a larger source identity/update review design. The final migration
**disables** academic Apply, including preexisting reviews. No alternate calendar
store or speculative source-ID scheme was added. Correct activation requires
trusted source + stable source-entry ID, immutable import baseline, locked
divergence comparison and explicitly reviewed updates.

## 8. Blackboard Screenshot

Can screenshot text establish trusted Blackboard identity? **NO**.
The repair removed fabricated mapping writes. Visible labels can only inform a
course proposal; existing deterministic owner/account/source mappings remain
authoritative. No screenshot field, hash, index or code is accepted as a provider
identity. The course-only screenshot workflow is still disabled because its image
transport and review contracts are incomplete.

## 9. Notes AI

- Summary: informational output exists, but automatic insertion into editor draft crossed into ordinary autosave without a persisted mutation review. Final review removes that write path.
- Rewrite: one owner Note is read initially but its ID/revision is not persisted as authority. Apply signs another browser Note ID. Runtime/SQL field mismatch prevents real rewrite success; the SQL-accepted shape demonstrates missing source binding/freshness independently.
- Action items: UI selections/edits never become a successor; runtime list uses a field SQL does not read, producing zero Tasks while consuming the review. The accepted SQL shape also lacks a required Note existence check.

All three capabilities are denied before preparation/egress; mutation RPCs are
revoked. Normal Note saving remains available. No functioning stale rewrite,
selected-item Apply or AI undo is claimed.

## 10. Quick Capture

Runtime output nominally discriminates Task versus Calendar Event, but permissive
coercion, missing/invalid date defaults, unknown keys and truncation remain. SQL
expects `capture_type`/`task`/`event`, whereas the parser emits
`type=propose_quick_capture`/`captured.entityType`. Both real output variants fail
Apply. The alternative SQL-accepted shape appends `Z` to Manila wall time, shifting
a 09:00 task to 17:00 local. ID/digest checks exist but cannot repair these contracts.
Final AI capture is denied; manual capture remains unchanged except restoring the
refresh removed by the repair.

## 11. Schedule Screenshot

The SQL transaction targets canonical Courses/Course Meetings and rolls back
domain/audit failure together. Same-batch replay is guarded. A second review of
the same schedule creates duplicate meetings. Course matching occurs by current
code at Apply, ignoring the reviewed target ID and without a canonical revision
baseline/shared manual-write lock. Edited proposals are persisted unvalidated
under the wrong discriminator; invalid weekday SQL defaults to Monday. All new
Apply functions omit the baseline `suggest_only` permission check. Screenshot
transport is unavailable. Preparation and Apply are now denied; no parallel
timetable was introduced.

## 12. Cloud Privacy

| Capability/group | Stored consent flag | Final transfer control |
| --- | --- | --- |
| Task checklist | `checklist_cloud` | Existing scoped preference + exact Send once |
| Text Course import | `course_import_cloud` | Existing scoped preference + exact Send once |
| Schedule screenshot | `school_schedule_cloud` | Denied regardless of preference |
| Blackboard screenshot | `blackboard_course_cloud` | Denied regardless of preference |
| Academic calendar | `academic_calendar_cloud` | Denied regardless of preference |
| Assessment prediction | `assessment_prediction_cloud` | Denied regardless of preference |
| Note summary/rewrite/action items | `notes_cloud` | Denied regardless of preference |
| Quick Capture | `quick_capture_cloud` | Denied regardless of preference |
| Daily planning | `daily_plan_cloud` | Denied regardless of preference |
| Material summary/questions | `course_material_cloud` | Denied regardless of preference |
| Contextual assistant | `contextual_assistant_cloud` | Denied regardless of preference |

Local failure auto-uploads to cloud? **NO**. The existing routing client offers a
new provider-specific confirmation before cloud send. Invalid output is terminal.
Explicit Local does not fall back to cloud; ambiguous cloud timeout is not silently
retried. Binary input is refused by all five adapters. Repair consent separation
was verified independently of final quarantine, not inferred from blanket denial.

## 13. Images

PNG/JPEG/WebP only, MIME/signature agreement, real full decode, 5 MiB input/output,
8192 maximum width/height, 16,777,216 pixels, one frame and five-second decoder
processing timeout. Re-encoded PNG strips metadata; only sanitized basename remains.
No remote URL, browser filesystem reference or arbitrary local path is fetched.
All image transports remain disabled, even for a model named as vision-capable.
The repair could prepare/store a derivative before transport rejection; final
entry denial prevents new derivative persistence. Existing rows are preserved.

## 14. PDF / DOCX

**DISABLED**

TXT/MD/CSV/ICS only: complete UTF-8, 256 KiB input, 25,000 characters and 32 KiB
normalized text. Malformed UTF-8, binary/disguised PDF and oversize sources fail.
PDF/DOCX being disabled is acceptable and is not a reason for this FAIL verdict.

## 15. Informational AI

Daily Plan remains browser-authored context, not an owner-scoped canonical planner
reread. Material summary/questions use real schema columns and require the first
three selected IDs to resolve to one Course, but silently omit later IDs rather
than rejecting an oversized selection. Contextual Assistant reads **exactly one
explicitly selected Task, Course, Note or Course Material**, with no related-entity
traversal, global search, database tool, browsing or mutation. Output contracts
still filter/truncate malformed data. Canonical source freshness/disclosure is
incomplete, so these informational capabilities remain disabled.

## 16. Database / RLS / RPC

Good repairs retained: authenticated owner scope, HMAC kept server-side, empty
search paths, protected source/batch/step writes, five-minute source expiry,
restricted prediction DML, and row-locked transactional Apply/confirmation.
`ai_read_scoped_review` is an owner-RLS reader, not a signed RPC.

Unresolved activation defects: no strict schema validation in record/revise RPCs,
no source-entity/revision relationship, no permission-mode check in new Apply,
no prediction-created-entity audit relationship, and unsafe calendar identity.
The final additive migration revokes all twelve new prepare/record/revise/mutation
RPCs from PUBLIC/anon/authenticated, blocks scoped attempts through the private
source guard, restores the prediction state guard, and adds scoped batch FK owner
equality. Existing owner SELECT and signed rejection are preserved. Removing the
default third source-helper argument avoids overload ambiguity while retaining
the unchanged two-argument baseline implementation. Full-chain baseline tests pass.

## 17. Adversarial Tests

- `school-repair-regression.integration.test.ts`: **15 tests**, explicitly pinned to the submitted repair migration. Reproduces same-title loss, manual divergence/stale import overwrite, prediction Task/Event substitution, missing provenance, queued replay/terminal checks, real Note/Quick Capture contract mismatches, SQL-level Note source substitution, timezone shift, duplicate schedule reimport, suggest-only bypass, unvalidated successors, cross-course prediction, and full cross-domain consent matrix. Tests labeled as historical defect evidence must not be counted as working-feature certification.
- `ai-trust.integration.test.ts`: **59 tests**, all migrations including final containment. Preserves baseline adversarial coverage and adds authenticated/anonymous RPC denial with valid HMAC, preexisting exact-review denial, source/batch owner isolation, protected DML, blocked existing attempts and all-flags-enabled cloud denial.
- `school-intelligence-security.test.ts`: **27 tests**, entry-point denial before auth/read/sign/write/fetch with malformed and substituted payloads, repeated/concurrent prediction denial, four routing modes and five binary adapter denials.
- Image/text extraction: **26 tests**. Existing router/consent/source/replay/owner tests also ran in the full suite.

PGlite is a single connection. `Promise.all` there tests queued calls, not concurrent
live transactions. No UI button state is relied upon for replay protection.

## 18. Validation

- typecheck: **PASS** after fixing the independently reproduced undefined-`err` error.
- lint: **PASS**, zero errors/warnings after removing two unused repair variables.
- tests passed: **790**; **86 files passed**.
- tests skipped: **2**, one live Supabase test file; not counted as passed.
- focused security tests: **127 passed across five files**.
- build: **PASS**, Next.js 16.3.3, production compile/type validation and 24 pages.
- diff-check: **PASS** before commit.
- frozen install: **PASS**, exact `pnpm install --frozen-lockfile`, lockfile unchanged.
- PGlite: **PASS**, actual migrations; current trust suite plus separate historical repair reproductions.
- live Supabase: **NOT RUN**, required test URL/publishable/service-role configuration absent.

Initial focused repair tests passed (75), while typecheck failed. That directly
demonstrates why the reported green test count was insufficient. Runtime tools
needed the bundled Node directory on PATH; package install needed sandbox escalation
for the pnpm store/registry. No dependency versions changed.

## 19. Remaining Findings

Blocking: source identity/freshness, exact successor validation/edit UX, prediction
confirmation/provenance, calendar identity/divergence, runtime/SQL contract agreement,
strict malformed-output rejection, and canonical informational context. They are
contained, not repaired into functional features. Non-blocking debt: persisted
source/review retention has no cleanup job; disabled controls remain visible in
some surfaces and need accessibility testing before activation. No future phase
was implemented and no unsafe parser/vision path was enabled.

## 20. Live Testing Not Performed

No real Gemini/OpenRouter/Ollama/llama.cpp/OpenAI-compatible runtime, Tailscale,
remote Companion, physical iPhone/PWA, live Supabase, multi-connection PostgreSQL,
or browser accessibility session. No production data, environment secrets or paid
provider calls were used.

## 21. Final Recommendation

Do not merge the repaired feature branch into main. Signed persistence and row
locks are real improvements, but canonical source freshness and exact reviewed
behavior remain missing or inconsistent. Final containment closes reachable unsafe
paths and preserves baseline AI/manual workflows; it does not meet the requested
feature merge standard. Each disabled capability needs its specified contract and
end-to-end adversarial verification before another merge review. PDF/DOCX may
remain disabled and need not block that future review.
