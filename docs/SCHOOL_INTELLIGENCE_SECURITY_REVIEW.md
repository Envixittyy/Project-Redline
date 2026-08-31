# Project Redline — School Intelligence Security Review

## 1. Verdict

**FAIL — DO NOT MERGE**

The new capabilities do not implement the existing signed-source, persisted-review,
ID-only approval contract. This review contains the unsafe paths without weakening
Phase 10A/10B. Containment is not feature completion: all twelve new capabilities
and prediction conversion remain disabled pending separately reviewed repairs.

## 2. Repository State

- Feature reviewed: `agent/gemini-school-intelligence`.
- Base: `4c46f81` (`feat(ai): add remote and hybrid AI routing`).
- Reviewed HEAD: `a873906` (`fix(ai): finalize school intelligence integration`),
  including the final follow-up after `d244513`.
- Review branch: `codex/school-intelligence-security-review`, created from that HEAD.
- Both the original feature worktree and review starting point were clean.
- Review/fix commit: the separate `fix(ai): harden school intelligence trust boundaries`
  commit containing this report; its exact hash is recorded in the final review response.
- Scope: all 77 changed files in `4c46f81..a873906`, with detailed inspection of
  repositories, actions, contracts, routing, extraction, SQL and mutation consumers.
  Decorative changes were inspected without a visual redesign.
- No merge, push, live database migration, environment-file population or provider call.

Required architecture, roadmap, personality, remote-routing and Companion documents
were read. Local Next.js 16.3.3 Server Action/data-security documentation was used.

## 3. Trust Boundary Summary

The existing checklist and text course-import flow retains:

inference → untrusted output → server validation → signed/persisted review →
explicit approval → canonical mutation with audit.

The feature additions did not retain that chain. Protected AI tables correctly
reject their preparation/finalization writes, while several new Apply endpoints
could independently mutate ordinary owner data using browser payloads. An
authenticated action is not proof of a reviewed AI proposal.

The review adds unconditional denial in `school-intelligence-policy.ts`, the router
capability lookup and every new repository prepare/finalize/Apply entry point.
Prediction conversion and speculative supersession are also denied. No preference,
provider name, forged review ID or environment variable enables these paths.
The dormant implementations are retained for a bounded follow-up, not attested as safe.

## 4. Findings

Status wording matters: **fixed** describes a repaired local boundary; **contained**
means the affected feature cannot run and its functional blocker remains open.

| ID | Severity | Area / problem | Exploit or failure scenario | Fix / disposition | Test / evidence |
| --- | --- | --- | --- | --- | --- |
| SI-01 | BLOCKING | New source/review persistence bypasses signed RPCs | All new repositories insert directly into protected `ai_course_requests` / operation tables. Capability and handle checks only accept the old course-import contract; several use nonexistent `timeZone`. Some finalizers ignore failed inserts and return fabricated batch IDs. | Contained: all twelve capabilities denied before preparation/finalization. Requires new narrow signed lifecycles, not relaxed RLS. | Actual-migration PGlite tests reject all twelve capabilities through the signed course-source RPC; direct repository tests assert no auth/read/write/fetch. |
| SI-02 | BLOCKING | Schedule, Blackboard, academic calendar and prediction Apply trust browser payloads | An unrelated owner-owned proposed batch can authorize attacker-supplied records. No exact capability, persisted steps, current revision, expiry or immutable review binding. Ignored protected batch updates leave replay possible. | Contained at every Apply entry point. Atomic domain mutation plus audit and conflict checks remain unimplemented. | Repeated direct entry-point calls deny before dependencies; existing DB proposal-forgery tests stay green. Functional dedupe/stale Apply success is not tested or claimed. |
| SI-03 | BLOCKING | Note rewrite/action items and Quick Capture bypass reviewed approval | A caller can submit arbitrary replacement text or task/event drafts without any persisted review. Note action items can create tasks even when the note lookup returns nothing; replay duplicates tasks. | Contained at repository functions and router. No new generic executor added. | Direct endpoint dependency-spy tests cover all exported functions, including Apply and repeated calls. |
| SI-04 | BLOCKING | Prediction confirmation creates entities before validating prediction | Missing, foreign, terminal or repeated prediction IDs can create an owner Task/Event; the later status update is neither conditional nor atomic and its error is ignored. | Task/Event conversion and confirmation RPC denied. Functional ID-only atomic conversion, provenance and idempotency remain a blocker. | Concurrent malformed/replayed conversion calls make zero repository writes; actual DB tests deny direct confirmation and terminal reopening. |
| SI-05 | HIGH | Prediction SQL permits forged provenance and invalid transitions | Authenticated direct DML can fabricate predictions/reopen statuses. Owner guard only checks Course, not calendar/material/external-record references. RPCs retain default PUBLIC execute. | Fixed boundary: new migration revokes client DML and confirmation, checks FK owner/course relationships and immutable ownership, enforces terminal transitions, permits only narrow authenticated active-to-dismissed RPC. | Five added actual-migration tests cover grants, owner/foreign/anonymous reads and dismissal, replay, terminal state, all FK mismatches and capability smuggling. |
| SI-06 | HIGH | New data domains inherit unrelated cloud consent | Notes/images/materials inherit `courseImportCloud`; contextual Note Q&A inherits `checklistCloud`. Binary source disclosure/modality metadata is absent. Existing DB restrictions prevented a successful new transfer; no actual leak was observed. | Fixed denial: only the two baseline capabilities may use their existing flags. All adapters reject image-bearing requests before transport. Binary consent and modality activation remain blocked. | All twelve capabilities tested in four modes with every cloud flag enabled; three local and two cloud adapters make no image fetch. |
| SI-07 | HIGH | Image validation only checks short signatures and bytes | Header-only malformed files pass; declared image MIME can disagree with bytes. Dimensions, decoded pixels, animation and metadata are not bounded. | Fixed bounded decoder: Sharp normalizes accepted PNG/JPEG/WEBP to metadata-free PNG with byte/pixel/dimension/time limits. Vision stays disabled. | Fifteen real-image cases cover round trips, spoofing, signature-only inputs, truncation, compressed pixel bombs, animated WebP and EXIF/path stripping. |
| SI-08 | HIGH | Document parser/resource and installation regressions | Undeclared `mammoth`, `pdf-parse`, `jszip` break typecheck; lockfile has five unmatched dependencies. Complex parsing has no isolation/decompression/page budget and silently truncates source text. | Fixed install and baseline extraction; PDF/DOCX disabled. Complete UTF-8 text is bounded and oversized input rejected. Sharp 0.35.3 declared directly; unused parser lock entries removed. | Initial frozen install and typecheck reproduced failures; final frozen install/typecheck/build pass. Text tests reject unsupported binaries, invalid UTF-8, limits and PDF disguised as text. |
| SI-09 | HIGH | Blackboard screenshot invents identity | `sourceLabel` is treated as an external Course ID; writes use columns absent from canonical mappings. Real mapping identity is owner/account/source-course-name. | Contained; deterministic mapping untouched. Screenshot labels cannot establish Blackboard identity. | Repository denial tests prevent any mapping write; schema comparison confirms mismatch. No successful mapping import is claimed. |
| SI-10 | HIGH | Academic calendar re-import lacks stable identity/divergence | Hashing title plus date makes a changed date a new identity. Upsert targets the wrong unique key, ignores failures, and has no previous-source baseline or user-divergence check. | Contained; no alternate calendar store or unsafe upsert activated. Requires stable source linkage and explicitly reviewed updates. | Direct Apply denial; static comparison with canonical owner/source/external-ID index. Changed-source/divergence happy paths remain unimplemented. |
| SI-11 | HIGH | Context freshness, scope and output validation incomplete | Prediction context falls back to all Course materials and broad user calendars, uses nonexistent material columns, has no revision manifest; selected-material queries also use wrong fields. Several parsers coerce/truncate instead of rejecting excess data/unknown keys and accept unsupported identifiers or dates. | Contained. Source selection/revision and strict output contracts must be repaired per capability before activation. | Entry-point denial plus existing contract tests; those parser tests are not evidence of a secure functional lifecycle. |
| SI-12 | MEDIUM | Review/confirmation UI misrepresents approval | Syllabus edits displayed in the new modal are ignored by ID-only Apply of the old review. Home/Course remove predictions even after failed confirmation/dismissal. Task Editor close target shrank from 44px to 36px. | Fixed active paths: restored original edited-review CourseImportModal; remove predictions only on successful action; show failure; restore 44px close target. | Source inspection, lint, typecheck and production build. No browser/phone accessibility test claimed. |

## 5. Multimodal / Image Boundary

The standalone server validator accepts PNG, JPEG and WebP containers, requires
matching declared MIME when supplied, fully decodes and produces a PNG derivative.
Input/output are limited to 5 MiB; width/height to 8192; pixels to 16,777,216;
reported frame count to one; decoder processing has a five-second timeout.
EXIF/XMP/IPTC are not retained. File paths become display basenames; no filesystem
read, image URL retrieval or arbitrary network fetch is performed.

No vision transport is enabled. Ollama, llama.cpp, local OpenAI-compatible runtimes,
Gemini and OpenRouter reject any `images` field, including empty/oversized arrays
and remote URLs. The Companion request schema already rejects images. Model names
are never treated as proof of vision support. A text-only model fails closed;
a vision model is also denied until a reviewed modality/derivative/consent contract
exists. This is containment, not working multimodal routing.

## 6. Schedule Screenshot Apply

**Not secure or functional as submitted; now disabled.** The implementation targets
canonical Course/Course Meeting tables, not a separate timetable, but directly
writes from mutable browser arrays. Existing Course matches, meeting ranges,
ownership, missing values and dedupe must be checked at persisted approval time.
No trustworthy stale-review, duplicate-Apply or atomic audit semantics exist.

## 7. Blackboard Screenshot

The deterministic Blackboard integration is preserved unchanged. Visible labels
are not real Blackboard source IDs. The disabled screenshot repository's mapping
columns do not match the current schema. A future reviewed Course match/create may
leave mapping unresolved; it must never synthesize identity or overwrite existing
deterministic mappings. No Blackboard scraping, grades, messages or documents added.

## 8. Academic Calendar

The active text extraction boundary accepts TXT/MD/CSV/ICS, but these are complete
UTF-8 source text, not a claim of deterministic semantic ICS/CSV parsing. Input is
256 KiB maximum, extracted text 25,000 characters and 32 KiB UTF-8 maximum.
PDF/DOCX, including malformed/scanned files, fail closed without invoking a parser.
PNG/JPEG/WebP validation exists independently; image inference is disabled.

Academic calendar preparation/review/Apply is disabled for every format. Its old
source/date hash, incorrect upsert conflict key and ignored DB errors are not
repaired into a functioning import. Stable source identity, proposed date updates,
manual-divergence preservation and audit must be implemented together before use.
Existing native and external calendars remain distinct and canonical.

## 9. Assessment Predictions

The table has RLS, owner/date/status and owner/course indexes, timestamp maintenance,
bounded text, and categorical HIGH/MEDIUM/LOW confidence. No numeric certainty is
introduced. The review closes client writes, FK ownership gaps and terminal
reopening while retaining owner reads and explicit dismissal. Existing rows are
not retroactively attested as model-generated, current or correctly sourced.

Generation/recalculation is user initiated, not performed on page load; it is now
denied. Generation had no canonical revision/recalculation supersession contract.
The heuristic `supersedeMatchingPredictions` has no integration caller and is also
quarantined; confirmed Blackboard feed reconciliation is not implemented.

Projection types explicitly use `assessment_prediction` and “Possible”, and exclude
LOW/terminal rows. However, Calendar/Home schedule callers do not supply predictions
to `buildCalendarItems`; the feature is not connected. Its dormant all-day UTC
conversion and missing visible-range filtering must be corrected before activation.
Home/Course cards do independently read predictions and label them speculative.

## 10. Confirm-as-Task Review

| Question | Submitted HEAD | After review fixes |
| --- | --- | --- |
| Can AI itself confirm a prediction? | **NO** model tool/automatic inference transition found; the browser action is nevertheless unsafe. | **NO**; conversion is denied. |
| Can replay create multiple Tasks? | **YES**; creation precedes prediction lookup/state validation. | **NO**; every conversion is rejected before a write. |
| Is server-side revalidation performed? | **NO** canonical prediction reread/current-source check. | **NO** functioning conversion exists; unconditional denial is not revalidation. |
| Does prediction state update atomically/safely? | **NO** for conversion. | **NO** implemented atomic conversion; it is disabled. Owner dismissal is separately atomic and replay-safe. |

The same conclusions apply to Event confirmation. A follow-up must lock/recheck
the persisted owner prediction, active status and source revision, create exactly
one canonical entity and provenance link, and commit status/audit together.

## 11. Notes AI

The source lookup targets one selected owner Note, not global Notes. Nevertheless,
the source is a truncated snapshot without Apply revision checks. Summary should
remain informational; its “Insert at Top” option called the same unsafe rewrite
mutation. Rewrite accepts arbitrary browser text/mode and action items accept
arbitrary lists without persisted approval or replay protection. All three
capabilities and both mutation paths are now disabled; manual Notes remain usable.

## 12. Quick Capture

Declared outputs are Task or Event, but direct Apply accepts browser drafts without
a proposal ID or review binding. Dates are weakly validated; invalid/missing values
can default to today, local wall clocks are suffixed with UTC `Z`, and a missing
event end can become a zero-length event. Using a normal repository alone does not
authorize or validate a proposal. Both AI Apply paths are denied; manual capture
and its existing deterministic flow are not rewritten.

## 13. Daily Planning

The deterministic planner remains authoritative and its work-session approval
path is unchanged. New AI advice is informational and has no rescheduling action.
It nevertheless uses a browser-supplied task/schedule snapshot rather than a
canonical bounded planner source manifest, so its preparation is quarantined too.

## 14. Course Material Intelligence

The implementation requests selected IDs, truncates to three and queries only the
authenticated owner. It does not fetch arbitrary URLs or every material. However,
it neither enforces a shared selected Course nor requires every selected material
to resolve, and queries nonexistent `material_type`/`content` fields. Actual fields
are `type`, `title`, `description`, `url`. Limits are not a substitute for an exact
source/revision manifest. Summary and study questions stay disabled/informational.

## 15. Contextual Assistant

**Can it access anything beyond the selected entity? NO global search or implicit
related-entity traversal was found.** The code selects a UUID and authenticated
owner from a finite Task/Course/Note/Material type. There are no tools or mutations.
Some selected-field queries conflict with the current schema, canonical revisions
are absent, and persistence/consent is incompatible. The capability remains denied
before any read; it has not become an “Ask Redline anything” endpoint.

## 16. Capability Audit

Below, context/output describe the submitted intent, not verified live support.
**Every row is disabled, can write NO, and cloud allowed NO.** “Review” states the
requirement before any future canonical write; a preview alone is insufficient.

| Capability | Context | Output | Can Write? | Requires Review? | Vision? | Cloud Allowed? |
| --- | --- | --- | --- | --- | --- | --- |
| `schoolScheduleImage.propose` | One selected screenshot | Courses/meetings | No | Yes | Intended; disabled | No |
| `blackboardCourseImage.propose` | One screenshot/visible labels | Course matches | No | Yes | Intended; disabled | No |
| `academicCalendarImport.propose` | Selected document/image | Calendar proposals | No | Yes | Intended; disabled | No |
| `schoolAssessmentPrediction.propose` | Course/syllabus/calendar context; overbroad | Speculative predictions | No | Yes | No | No |
| `noteSummary.propose` | One Note | Summary | No | Informational; insertion requires separate review | No | No |
| `noteRewrite.propose` | One Note | Replacement text | No | Yes | No | No |
| `noteActionItems.propose` | One Note | Task proposals | No | Yes | No | No |
| `quickCapture.propose` | Selected text/time context | Task or Event | No | Yes | No | No |
| `dailyPlanAdvice.propose` | Browser task/schedule snapshot | Advice | No | Informational | No | No |
| `courseMaterialSummary.propose` | Up to three selected owner materials | Summary | No | Informational | No | No |
| `courseMaterialStudyQuestions.propose` | Up to three selected owner materials | Study questions | No | Informational | No | No |
| `contextualAssistant.propose` | One selected entity/question | Answer | No | Informational | No | No |

The two baseline checklist/course-import capabilities retain their existing exact
permissions, bounds, reviews and capability-specific cloud consent. No generic
database/read/write/execute capability was introduced or authorized by this review.

## 17. Prompt Injection

Provider output has no tool execution path. The active baseline depends on signed
canonical preparation, strict schemas, persisted approval and RLS, not prompt
wording. Text such as “delete every task” cannot authorize operations. The new
contracts do have runtime parsers, but several silently slice arrays/strings,
coerce types or tolerate extra authority-like fields. Their arbitrary-ID/date
handling and browser Apply payloads fail the requested strict boundary. They remain
denied at server entry points regardless of source instructions or provider choice.

## 18. Database / RLS

Migration `20260831130000_school_intelligence_predictions.sql` adds an enum value and
prediction table; it does not make the new AI source/review schema compatible.
The additive review migration `20260831140000_school_intelligence_quarantine.sql`:

- Preserves data and owner-scoped SELECT; revokes PUBLIC/anon/authenticated writes.
- Revokes the confirmation RPC and default PUBLIC/anon dismissal execution.
- Restricts dismissal to `auth.uid()` + active prediction in one UPDATE; only
  authenticated callers can execute its narrow SECURITY DEFINER function.
- Uses an empty search path and schema-qualified application objects.
- Validates every prediction FK's owner, with Course matching for material/feed
  references, and prevents changing prediction ownership.
- Prevents terminal-state reopening and any new transition to confirmed.

RLS is not weakened; application code uses no service-role workaround. Tests apply
the migration chain in PGlite and impersonate roles. No production migration was
run. Existing invalid legacy references are not silently rewritten or certified.

## 19. Provider Routing / Privacy

New UI inference uses the existing provider-neutral router; no feature-side direct
Gemini/Ollama/OpenRouter call was found. Existing fallback requires an explicit
offer, applicable capability gate and current send consent. Malformed output stays
non-fallback. Neither provider nor model choice widens permission.

The inherited capability consent bug is removed. All new capabilities fail before
source preparation/transfer and all binary transports reject images. No local
failure can silently upload a new image, document or Note through these paths.
Exact binary disclosures and trustworthy model modality metadata are still absent;
they must be implemented before enabling vision, rather than guessed from names.

## 20. Tests Added

- `school-intelligence-security.test.ts`: 27 parameterized cases covering every
  new capability, four routing modes, direct repository bypass/replay, concurrent
  denied prediction conversions, three local runtimes and two cloud transports.
- `ai-trust.integration.test.ts`: five added actual-migration cases; 43 total.
  Covers prediction grants, owner-only dismissal, anonymous/foreign/missing IDs,
  replay, terminal transitions, FK ownership and all twelve capability smuggling attempts.
- `image-validator.test.ts`: 15 real decoding/format/resource/metadata cases,
  replacing header-only acceptance assertions.
- `text-extractor.test.ts`: 11 cases for supported complete UTF-8 text, limits,
  invalid bytes, unsupported PDF/DOCX/ZIP and disguised PDF sources.

Denied-path tests prove containment only. They do not claim successful atomic
prediction conversion, stale review resolution, Academic Calendar divergence,
Blackboard supersession or vision inference. Those remain required repair tests.

## 21. Validation Results

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test`: **759 passed, 2 skipped; 85 files passed, 1 file skipped (86 total)**.
- Focused security/extraction/actual-migration run: **96 passed across 4 files**.
- Skipped: the two cases in `owner-rls.integration.test.ts`; live
  `SUPABASE_RLS_TEST_URL`, publishable key and service-role test configuration absent.
  They were not counted as passed. The local actual-migration suite did run.
- `pnpm build`: PASS; Next.js 16.3.3 production compilation/type validation and
  generation of 24 pages completed.
- `git diff --check`: PASS before commit.
- `pnpm install --offline --frozen-lockfile`: PASS after dependency repair.

Initial submitted-state frozen installation and typecheck failed on dependency
inconsistency; these were reproduced and repaired, not excluded from the audit.

## 22. Live Testing Not Performed

No real Ollama/llama.cpp/OpenAI-compatible model, Gemini, OpenRouter, remote
Companion, Tailscale, physical iPhone/PWA, browser screenshot/accessibility session
or live Supabase deployment was tested. No paid cloud calls. Concurrent JavaScript
denial tests and local SQL role tests do not constitute a live multi-connection
Postgres conversion race test.

## 23. Remaining Non-Blocking Findings

- Existing AI source/review retention has no cleanup job; this review adds none
  and does not retain new image transfers. Retention policy remains explicit debt.
- Dormant AI controls still appear in some views and return an unavailable message;
  this is an availability limitation, not completed functionality.
- The unused custom Select and dormant AI dialogs need focused keyboard/touch
  accessibility verification before activation. No full visual audit was requested.

The source/review, atomic conversion, dedupe/divergence, source freshness and vision
activation gaps above are **blocking**, not reclassified as non-blocking because
their paths are contained. No future roadmap phase has been implemented.

## 24. Merge Recommendation

**DO NOT MERGE**

Keep these review fixes separate from Gemini's commits. Do not remove the code
denial or relax protected AI-table grants to make the prototypes run. Each blocked
capability needs a scoped implementation of its canonical source/revision,
immutable review, exact approval and atomic mutation/audit contract, with successful
and adversarial integration tests, before another merge review.
