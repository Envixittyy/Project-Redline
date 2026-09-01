# Architecture

## Goals

The repository is a deliberately small foundation for Forward, a personal, single-user application. It separates framework concerns, reusable interface code, feature ownership, and external systems without introducing speculative layers. Project Redline and existing `life_os` identifiers are historical/internal names, not architectural namespaces. Cross-phase contracts are indexed in `docs/FORWARD_ARCHITECTURE.md`.

## School Intelligence security review (2026-08-31)

The `agent/gemini-school-intelligence` checkpoint `a873906` does **not** satisfy the
Phase 10 trust contract and is not approved for activation. The security review
branch preserves the implementation for repair but quarantines its twelve new
capabilities before source preparation, finalization, Apply, or provider egress.
`school-intelligence-policy.ts` is a code-level denial, not a preference or an
environment toggle. Existing signed checklist and text course-import workflows
remain active. The School entry point again uses the existing course review UI,
including immutable edited reviews and separate ID-only approval.

The new repositories require incompatible direct writes to protected source and
proposal tables, lack canonical source revision contracts, and accept browser
Apply payloads. They must not be activated by relaxing RLS or widening existing
course-import/checklist consent flags. Each needs a compatible narrow signed
source/review lifecycle and atomic canonical-domain mutation/audit before its
denial can be removed. Prediction conversion is also disabled; it is not an
implemented atomic Task/Event confirmation flow.

Migration `20260831140000_school_intelligence_quarantine.sql` preserves prediction
data and owner-scoped SELECT, revokes client writes and the confirmation RPC,
and leaves only authenticated owner-scoped active-to-dismissed dismissal. It
checks all prediction foreign-key owners/course relationships and prevents
terminal-state reopening. Existing prediction rows are not retroactively attested
as server-generated or current. No production database was changed by this review.

The image validator now fully decodes PNG/JPEG/WEBP, enforces a 5 MiB input/output
limit, 8192-pixel dimensions, 16,777,216 pixels, a single frame and a five-second
decoder timeout, then emits a PNG derivative without EXIF/XMP/IPTC metadata.
Sharp `0.35.3`, already a Next.js transitive dependency, is declared directly.
Validation alone does not authorize transfer. Pass 2A adds modality metadata,
short-lived normalized derivative storage and exact binary disclosure/consent.
Pass 2C activates Schedule and Blackboard Course screenshots on that layer. Pass
2B subsequently activates the separately scoped Academic Calendar image consumer.

Document extraction again accepts only complete UTF-8 TXT/MD/CSV/ICS: 256 KiB
input, 25,000 characters and 32 KiB UTF-8 text. Oversized sources fail rather than
truncate. PDF/DOCX parsing is disabled pending resource-bounded extraction;
undeclared parser/test dependencies were removed from the lockfile. No source
retention job, alternate calendar store, generic executor, or future phase was
introduced. See `docs/SCHOOL_INTELLIGENCE_SECURITY_REVIEW.md` for findings and
verification.

### School Intelligence repair — Pass 2 prediction adapter

Migration `20260831190000_school_prediction_generation.sql` activates only local
assessment prediction generation. The user explicitly selects one canonical
Course and one saved Course Material whose type is `syllabus`. A Pass-1 version-2
manifest binds the Course and its complete meeting collection plus the selected
syllabus. SQL assembles the minimized context and opaque handles; model output
cannot name Course, source, URL, or database IDs.

The finite Pass-1 registries now include the exact prediction schema. A School-only
prepare/record/revise surface delegates to the same source locks, freshness checks,
sealed reviews, strict successors, mutation-policy check, and transaction-bound
begin/finish helpers. Apply inserts predictions from the persisted step and records
the generation request, batch, ordinal, source manifest and local relay provenance.
Generated fields are immutable apart from the guarded active-to-dismissed or
active-to-superseded lifecycle. Explicit recalculation supersedes earlier generated
active rows but preserves their historical basis. Page reads compare current
canonical fingerprints without inference; stale predictions remain visible in
School for explanation but are excluded from Home and Calendar.

This adapter is local or private-mesh local text only. The dedicated assessment
cloud flag remains a stored preference with no egress authority. Task/Event
conversion remains denied. Schedule and Blackboard screenshots are activated by
the later Pass 2C adapter described below. Academic Calendar import is activated by
the independent Pass 2B adapter below. PDF/DOCX and every Pass-3 capability remain
contained.

### Trusted Academic Calendar import — Pass 2B

Migration `20260901000000_academic_calendar_import.sql` keeps import source,
immutable source revision, source entry, and canonical `calendar_events` row as
separate identities. Owner-scoped sources have server-generated IDs and explicit
format association; filename is display provenance only. Revisions bind digest,
normalized content, format, provenance, and creation time. ICS UID plus recurrence
ID and explicit CSV IDs are strongest; conservative structure and semantics are
resolved server-side when a format has no trusted ID. Different sources never
share entry or baseline state.

`academic_calendar_entry_links` stores the canonical event and exact last-imported
Calendar baseline. A reimport compares canonical state with that baseline before
proposing an update. Divergence produces a three-way conflict and cannot overwrite
manual Calendar edits. Removed entries become absent while canonical events remain.
The ID-only Calendar consumer revalidates source, revision, entry, baseline,
canonical event, successor review, mutation policy, expiry and replay state, then
mutates Calendar and advances provenance in one transaction.

ICS/CSV use bounded deterministic parsers and never enter inference routing.
TXT/MD require strict extraction with unique verbatim evidence. PNG/JPEG/WEBP use
the Pass 2A normalized PNG authority and capability/model-bound disclosure with
fresh send-once cloud consent. No Academic Calendar provider fallback is automatic.
PDF and DOCX remain disabled.

### Model modality and normalized-image disclosure — Pass 2A

Migration `20260831200000_ai_vision_trust.sql` adds an owner-scoped, signed model
configuration registry, five-minute normalized image sources and single-use image
disclosures. Local and remote-local image authority comes only from an exact saved
provider/model record. Ollama and OpenAI-compatible local models may be explicitly
marked image-capable; llama.cpp remains text-only. Gemini and OpenRouter authority
comes only from the exact server-owned model plus its `*_MODEL_MODALITY` setting.
Model names are never inspected for vision hints. Missing metadata is `UNKNOWN` and
returns `unsupported_modality` before transport.

The authenticated server fully decodes the selected PNG/JPEG/WebP with the existing
hardened validator, normalizes it to metadata-free PNG and hashes those normalized
bytes. The trusted source stores owner, capability, SHA-256 digest, PNG MIME, size,
dimensions, status and expiry with the normalized bytes. Metadata-only inputs that
decode to the same pixels converge on the normalized-output digest; the raw upload,
filename and path have no disclosure authority.

A persisted disclosure binds the source and digest to one owner, capability,
provider, exact model, trusted modality source, `normalized_image` field, consent
state and expiry. Claim rereads and rehashes the stored bytes, rechecks model
configuration and capability-specific privacy, consumes the disclosure once and
returns canonical base64. Browser table writes and reads of image/disclosure rows
are denied. Revocation and explicit expiry purge erase bytes; authority expires
after five minutes even if cleanup has not yet run.

Companion image input is one explicit PNG byte field plus digest. Paths, URLs,
multipart forwarding and the legacy image array are rejected. Same-PC image calls
require the same exact-body ticket discipline as private-mesh calls. Ollama uses its
image byte field; the OpenAI-compatible adapter constructs a data URL internally;
llama.cpp rejects images. Cloud transport similarly constructs provider-native
image fields only after fresh capability-specific disclosure and consent. Image
errors, text-only models and unknown modality never trigger automatic cloud fallback.
Model output remains untrusted. This infrastructure alone grants no screenshot
preparation, proposal, Apply, or prediction-conversion authority; product adapters
must register their own finite source, review, and consumer contracts.

### Schedule and Blackboard screenshot activation — Pass 2C

Migration `20260831210000_school_screenshot_activation.sql` registers exactly
`schoolScheduleImage.propose` and `blackboardCourseImage.propose`. A scoped request
binds one Pass-2A validated PNG and one capability/provider/model/location-specific
disclosure. Its minimized `source_text` contains only trusted image/disclosure IDs,
digest, byte count, and route metadata; raw uploads never enter an inference adapter
or the generic text source path. Local and remote-local inference requires an
exact-body Companion image ticket. Cloud requires the capability flag, exact server
vision model, a separate Send-once confirmation, and the same disclosure claim.
Image attempts never enter automatic fallback.

Provider output is extraction only. Schedule accepts bounded visible Course code,
name, weekday, strict times, and optional room/end time. Blackboard accepts only a
visible label and optional visible code/title. Unknown keys, URLs, malformed values,
target IDs, Blackboard IDs, external IDs, and mapping IDs are rejected. Every row
starts as `IGNORE`. A user successor chooses `MATCH_EXISTING`, `CREATE_NEW`, or
`IGNORE`; the database seals exact existing-Course fingerprints into the successor.
Apply accepts only the batch ID and never performs fuzzy matching.

The fixed Schedule consumer creates or matches canonical `courses`, then adds
canonical `course_meetings`. Meeting dedupe uses Course, weekday, start/end, and
workspace time zone; room is excluded so a changed display room cannot duplicate an
existing time slot. The importer is additive and never deletes or replaces manual
meetings. The Blackboard consumer creates or matches `courses` only and never writes
`blackboard_course_mappings`; a screenshot label cannot establish provider identity.
Normalized Course-code conflicts such as `CPE201` / `CPE 201` fail for explicit
review instead of fuzzy matching. Pass-1 freshness, mutation policy, transaction
claim/finish, audit, replay, and rollback remain authoritative for both consumers.

## Directory structure

```text
src/
  app/
    (auth)/               Public auth routes outside the workspace shell
    (workspace)/          Routes sharing the responsive application shell
  components/
    shell/                Domain-neutral shell and navigation composition
    ui/                   Reusable, domain-neutral interface components
  features/
    auth/                 Sign-in/sign-out actions and server session guard
    capture/              Raw-capture state and interpretation lifecycle
    calendar/             Calendar read model, views, and native event editor
    focus/                Focus / Goldfish presentation read-model and distraction-free view
    notes/                Markdown note editor and private attachment controls
    offline/              PWA registration and truthful synchronization status
    operations/           Reversible operation/batch contract
    planning/             Deterministic scheduler input contract
    school/               Course and recurring-meeting workflows
    tasks/                Task interface, server actions, and presentation rules
  hooks/                  Shared React hooks with more than one real consumer
  lib/
    date/                 Calendar-day and time-zone helpers
    theme/                Theme metadata such as supported accent palettes
  services/
    captures/             Immutable capture reads and transactional proposal operations
    calendar-events/      Source-aware calendar-event persistence
    courses/              Course and recurring-meeting persistence
    external-calendars/   Source-aware external calendar mirrors and status reads
    notes/                Note persistence
    integrations/         Adapters for external systems
    supabase/             Browser, request, proxy, and admin trust boundaries
    tasks/                Task persistence
    work-sessions/        Task-owned planned-work persistence
  styles/                 Global semantic design tokens
  types/                  Types shared across genuine domain boundaries
supabase/
  migrations/             SQL schema history
```

Folders should gain code only when a phase needs it. Do not create generic repositories, managers, or utility collections in anticipation of future work.

## Application shell and routing

The `(workspace)` route group applies `AppShell` to Home, Tasks, Calendar, School, and More without adding a URL segment. The shell remains a server component. Its small `AppNavigation` client boundary reads the pathname only to expose the active route; page content does not become client-rendered as a consequence.

Primary destinations are defined once in `src/lib/navigation.ts` and consumed by both the persistent desktop sidebar and safe-area-aware mobile tab bar. Mobile content reserves enough bottom space for the fixed bar. Desktop content is constrained to a readable frame and can expand into multi-column dashboard layouts.

The shell also owns two small global client boundaries. `Ctrl/Cmd+K` opens the navigation-only command palette. `Ctrl/Cmd+Shift+Space` and visible desktop/mobile controls open Universal Capture. Both reuse feature routes and server actions rather than introducing parallel persistence paths.

School persists owner-scoped courses and recurring weekly meetings. The timetable projects meeting occurrences into Calendar through the calendar domain adapter; it never writes duplicated native event rows. Notes is a secondary route linked from More so the five-item mobile navigation remains stable.

Calendar is a working route as of Phase 1D. Its Month, Week, and Agenda modes are query parameters (`/calendar?view=week&date=2026-08-27`) so view and anchor date remain linkable. The page is a server component that resolves the visible range and reads events and tasks in parallel; `CalendarWorkspace` is the interaction boundary for view controls and editors. The mobile Month grid compresses item copy into semantic marks, Week uses an internally scrollable seven-day surface rather than overflowing the page, and Agenda is a readable narrow-screen list.

P3 adds `task_work_sessions` as the many-per-task home for planned work intervals. Calendar reads sessions by overlap, hydrates their owner-scoped tasks, and projects them alongside deadlines, native events, external mirrors, meetings, and legacy single-task schedule fields. Its editor creates, changes, and deletes only session rows. It never changes the task deadline or creates a `calendar_events` row.

Tasks is a working route as of Phase 1C. Its seven views are query parameters (`/tasks?view=today`) rather than nested routes, so Tasks stays a single destination in the primary navigation and secondary features never need to expand the mobile tab bar.

## Reusable UI and feature separation

`src/components/ui` is for visual primitives that do not know about tasks, school, football, or calendar semantics. A button, dialog, or generic surface belongs there. `src/features/<feature>` owns domain-specific components and rules. For example, a future task row belongs to `features/tasks`, even if it composes generic components from `components/ui`.

Feature business logic should be colocated with its feature rather than placed in pages or broad utility files. App Router files compose features and define routing; they should not become the primary business-logic layer.

## Design tokens and themes

`src/styles/tokens.css` is the visual contract. Components consume semantic values such as `--background`, `--surface`, `--text-primary`, `--accent`, `--accent-text`, `--border-subtle`, `--shadow-soft`, `--blur-surface`, radii, and motion durations. `--accent` is the palette identity for decoration; `--accent-text` mixes it toward the current primary text color so small accent-colored text and focus indicators retain contrast in both appearance modes. Components must not repeatedly hard-code a palette color.

Tailwind 4 theme mappings in that file expose the core semantic colors to utilities while raw custom properties remain available for CSS that needs shadows, blur, or motion. This keeps feature code independent from a particular aesthetic and makes a later redesign primarily a token change.

The foundation uses a native system-font stack. This avoids a network dependency during production builds, feels at home on Apple platforms, and remains readable on Windows. A bundled local brand font can replace it later without changing feature code.

Appearance is represented by `data-theme="system" | "light" | "dark"` on the root element. System mode uses `prefers-color-scheme`; explicit light and dark selectors override it. Phase 1B provides all three controls on More. A small synchronous bootstrap in the document head validates versioned browser-local preferences and applies root attributes before paint. Interactive controls subscribe to those attributes through a hydration-safe external-store boundary.

Accent selection uses `data-accent` and the centralized catalog in `src/lib/theme/palettes.ts`. Cobalt is the Forward default; Cyan, Violet, Graphite, and a restrained Warm Gold are alternatives. Red remains primarily destructive/error. Adding a palette means adding one catalog entry and its token values; feature components should not change.

Reusable `Surface` variants (`base`, `glass`, `elevated`, `subtle`, and `interactive`) centralize translucent backgrounds, borders, shadows, radii, and blur. Pages and features compose those variants instead of recreating glass styles or encoding palette colors.

Motion uses CSS where sufficient and includes global `data-motion` plus `prefers-reduced-motion` safeguards. `src/styles/motion.css` provides the canonical composited enter/interaction primitive. No animation library is installed. Translucent surfaces retain solid-enough backgrounds and borders so blur is decorative rather than required for readability.

## Responsive and accessibility foundations

Base styles target small screens first, use dynamic viewport units, include safe-area insets, and expand layouts through min-width media queries. The mobile tab bar uses icon-and-label targets sized for touch, remains fixed above the bottom safe area, and yields to the desktop sidebar at the shell breakpoint.

The root layout provides descriptive metadata and semantic HTML. Global focus-visible styling, readable foreground tokens, reduced-motion behavior, and Next.js accessibility linting establish defaults. New controls must still be checked for keyboard behavior, names, states, and contrast.

## Local UI preferences

Appearance remains a device-local UI preference with a versioned storage key. Home renders real owner-scoped Today, Overdue, Upcoming, and School summaries. A narrow client wrapper stores only widget visibility on the current device while the cards and their data remain server-rendered. P1 intentionally has no ordering, resizing, drag-and-drop, or server-side dashboard preference persistence.

## Notes, attachments, and offline behavior

`notes` stores private Markdown with optional task and course relationships. Autosave and explicit save use authenticated server actions. Attachment objects live in the private `private-attachments` Supabase Storage bucket; metadata and object policies both verify the owner, downloads use short-lived signed URLs, and failed metadata creation removes the uploaded object.

The App Router manifest and `/sw.js` provide the installable shell. IndexedDB stores only explicitly supported task and note mutations, each with a stable operation ID. Reconnect replay authenticates through a Route Handler and uses database uniqueness for create idempotency. The UI distinguishes Offline, Pending, Syncing, Failed, and Conflict; unsupported operations are never reported as synchronized.

## Services and integrations

External systems belong behind adapters under `src/services/integrations/<system>`. Blackboard has a concrete adapter. Calendar now has provider-neutral persistence and capability metadata, but no provider is represented as connected until its real adapter, server callback, encrypted credential, and external authorization exist. Notion and AI retain narrow cross-phase contracts. Do not add mock clients.

Integration adapters should translate provider-specific payloads into explicit internal shapes and preserve source identity. They must not leak SDK objects throughout features. Secrets stay server-side. Client components should not call privileged provider APIs directly.

Phase 10A provides narrow, server-authorized checklist and text-course-import pipelines. Phase 10B adds remote transport and Gemini/OpenRouter inference through those same contracts, not a new executor. The previous broad cloud dispatch and browser-authored context/handle/action path remains **disabled before provider egress**. Existing Phase 9 adapters, consent tables, and disclosure UI remain migration material. Notes AI assistance remains disabled. Normal task, note, calendar, school, and capture operations do not depend on AI.

The browser on the companion PC calls `http://127.0.0.1:41400` directly; hosted Next.js servers never fetch the user's localhost. The companion accepts only configured exact application origins and short-lived origin-bound pairing tokens. Browser endpoint values are assertions against daemon-owned runtime configuration, never proxy destinations. Three fixed adapters support Ollama, llama.cpp, and local OpenAI-compatible runtimes. Desktop browser local-network permission may be required. Remote clients instead use one operator-configured HTTPS Tailscale Serve origin forwarding to a distinct `127.0.0.1:41401` backend. That listener requires the exact Serve identity plus authenticated, owner/device-bound, 60-second one-use server tickets. No public/LAN listener, arbitrary URL, relay service, or direct runtime-port browser access is provided. Actual target-device deployment remains unverified.

The active authority contract is `taskChecklist.propose` plus `task.readMinimal`, scoped to one owner task. `prepareTaskChecklistAction` rereads canonical title, description, and existing checklist titles through the task repository, bounds context, and returns a random per-request task handle. The model receives neither database IDs nor credentials. `generateTaskChecklist` runs browser inference and sends untrusted output to `finalizeTaskChecklistAction`. Finalization independently validates the persisted request, exact capability, source revision, handle, size, and strict schema before recording a reviewable proposal. `applyAiProposalAction(batchId)` accepts only a persisted ID. It never executes browser action arrays. Gemini’s checklist review UI now uses these primitives in the Task editor; linked materials and unsaved browser edits never enter canonical context. Edits create a successor immutable batch via `reviseTaskChecklistAction`, invalidate the old ID, and require a separate approval.

Trusted `ai_requests` and AI operation batches/steps are not writable by ordinary authenticated clients. A separate server-only `AI_TRUST_SIGNING_KEY` and matching private database key authenticate narrow RPC commands, also bound to `auth.uid()`, operation, and expiry. The authenticated request client is retained; no AI service-role client is introduced. Provenance proves server validation, **not model/hardware attestation**: relayed inference text is always untrusted, including valid text invented by an authenticated browser.

The task repository calls one domain-specific SQL transaction to recheck review, permission, capability, source revision, and limits, create checklist subtasks, and record committed audit/result IDs. Task and parent-checklist locking serializes source edits against commit; a semantic SHA-256 revision detects content/status/course/checklist changes but ignores unrelated priority/deadline metadata. Domain or audit failure rolls back both. Repeated successful approval is idempotent. Proposals expire five minutes after preparation; expired, stale, rejected, unsupported, or untrusted requests never mutate tasks. AI checklist undo is not implemented.

Course import uses a separate `courseImport.propose` / `document.readSelectedText` capability. The server extracts a user-selected UTF-8 TXT/MD/CSV/ICS upload (256 KiB file, 25,000 characters, 32 KiB encoded context); no PDF/DOCX/XLSX/OCR is added. Immutable owner-readable `ai_course_requests` store normalized source text, SHA-256 digest, opaque document handle, capability, provider/model, canonical start date/time zone, and five-minute expiry. Model output is exact JSON for one new course and at most seven meetings, never existing-course edits or task creation. `reviseCourseImportAction` persists bounded user edits as a new review, atomically rejecting the previous ID. `applyCourseImportAction(batchId)` delegates to the normal course repository and one signed SQL transaction for course, meetings, result IDs, and audit. Duplicate course codes (including archived courses) return a conflict; existing courses remain unchanged. SQL rechecks the immutable source digest, permission, expiry, capability, review digest, and operation shape. Course writes share an owner lock with duplicate checking. No AI undo exists.

Gemini’s personality layer uses canonical task counts and the existing course-meeting calendar projection. Home no longer double-counts today/next-seven-day task overlap. Telemetry distinguishes successful database reads from unchecked sync/model health; companion reachability is checked only after a labelled browser action. Hidden commands remain exact-match only. New overlays use an accessible native dialog, 44px targets, safe-area bounds, and reduced-motion overrides. `docs/PERSONALITY.md` describes the voice; `docs/FORWARD_ARCHITECTURE.md` and semantic tokens remain the visual authority.

See `docs/LOCAL_COMPANION_ARCHITECTURE.md` for the Phase 10A trust foundation and `docs/REMOTE_HYBRID_AI.md` for current routing, remote setup, privacy and deployment boundaries. This supersedes earlier claims of an unrestricted Phase 9/10 action dispatcher; no image/OCR, autonomous AI, or later feature phase is included.

### Phase 10B inference routing and persistence

Both feature clients call `features/ai/routing-client.ts`; server routing/context/adapter code lives under `services/integrations/ai`. Server-owned `ai_preferences` selects Auto, Local, Gemini or OpenRouter. Auto tries the paired same-PC or remote-local selection, then an enabled preferred cloud provider, then an optionally enabled secondary. Each cloud offer requires the capability's explicit privacy flag, cloud enabled, consent mode not off, and a fresh native Send-once confirmation. Unknown capabilities and future sensitive domains fail closed. No fallback runs on malformed output, failed authorization, stale source, or Apply; ambiguous cloud network/timeout failures are terminal.

Migration `20260831120000_ai_remote_hybrid.sql` adds owner-readable, signed-RPC-write-only `ai_inference_attempts`. Immutable source links, provider/model/location, capability, canonical payload digest, byte count and source expiry bind each transfer; atomic claims consume consent and prevent duplicate send. There are at most three attempts per source, no repeated provider, and one active/successful attempt. A separate one-use claim limits remote inference-ticket issuance. Source and privacy are reread before dispatch. Gemini/OpenRouter use fixed server-only adapters and the existing exact proposal parsers. Browser local finalization cannot finalize cloud attempts or directly finalize cloud-created sources. None of this adds apply authority; existing ID-only review/apply RPCs and atomic domain-write/audit transactions remain unchanged.

Migration `20260831150000_school_intelligence_repair.sql` adds `ai_scoped_requests`,
protected scoped batch/attempt relationships, nine domain-specific privacy columns,
signed command RPCs and transactional domain Apply functions. These remain
**inactive repair material**, not certified workflows. A digest of a stored prompt
cannot check the current Note/Course/material/calendar state: the request lacks a
canonical source-ID/revision manifest. The review reader uses owner RLS, not HMAC.
Successor proposals are not strictly validated, and several SQL payload shapes
conflict with runtime contracts. Title-only calendar identity collides and overwrites
manual divergence. Local wall clocks are incorrectly assigned UTC. Prediction
conversion signs browser drafts and retains no created-entity provenance link.

Final containment migration `20260831160000_school_intelligence_final_containment.sql`
revokes scoped preparation/record/revision/Apply and prediction conversion, blocks
scoped inference preparation/claims including existing attempts, and denies every
new cloud capability regardless of stored opt-in. It preserves data, owner reads,
and signed rejection; restores the non-confirming prediction state guard; and adds
scoped batch/source owner equality. Application entry points also deny before reads,
signing or transfer. Baseline checklist and text course import remain active.
Images are never transferred; PDF/DOCX stay disabled. No new dependencies or cleanup
job were added. See `docs/SCHOOL_INTELLIGENCE_FINAL_VERIFICATION.md` for the FAIL
verdict, reproduced defects, and the separate tests of historical defects and final
containment. Activation requires complete source/review/validation contracts.

### School Intelligence trust repair — Pass 1 (still disabled)

Migrations `20260831170000_ai_scoped_source_freshness.sql` and
`20260831180000_ai_scoped_review_authority.sql` repair shared infrastructure without
granting product activation. Existing `ai_scoped_requests` gain a version-2 source
manifest and immutable authority digest; existing operation batches gain a sealed
review digest, predecessor relationship and transaction-bound consumption marker.
Legacy requests remain unversioned and cannot be adopted or applied by this layer.

Preparation accepts selected identities only, authenticates the signed command,
locks canonical records, constructs bounded context and computes fingerprints in
SQL. Fingerprint readers cover one Note, a Course plus normalized meeting set,
immutable text Capture plus lifecycle, Course Material, native Calendar Event,
provider-identified external calendar event, stable-UID Blackboard record, and
Prediction plus its currently linked dependencies. No reader fetches a URL or
returns credentials. Readers do not grant capabilities: only one-Note rewrite and
action-item schemas are registered as Pass 1 validation exemplars. All product
preparation/record/revision/Apply RPCs remain revoked, including these exemplars;
all application and cloud containment gates are unchanged.

Record and revision repeat canonical freshness checks and strict output validation.
Revisions preserve the same request/owner/capability/source/provenance/expiry, store
exact edited JSON values in a new step, link the predecessor, and atomically reject
its batch. Source and proposal fields are immutable under database triggers. The
digest includes request authority, batch ID, predecessor ID and exact reviewed
output; PostgreSQL JSONB serialization and fixed UTC timestamp formatting define
the digest format. Strings are neither trimmed nor silently truncated.

Future **fixed domain SQL functions** must call private `begin_scoped_apply`, use
only its persisted authority to mutate, then call `finish_scoped_apply` in the same
transaction. Begin verifies a signed capability-specific approval containing only
the batch ID, checks owner/state/expiry/digests, locks and recomputes sources, and
enforces `ask_before_changing`. Finish records result IDs and source/provider/review
provenance, then consumes the batch/request atomically. A deferred constraint
rejects unfinished claims at commit. The claim uses PostgreSQL's transaction ID,
not a caller-controlled GUC. Neither helper has client execute permission; there
is no generic Apply RPC, dynamic SQL dispatcher, callback or network operation.
Tests install temporary fixed Note/Task consumers only inside isolated PGlite.

Course meeting writes share a parent Course lock so inserts/deletes/reparenting
cannot evade a collection fingerprint. Preference changes share a policy lock,
including insert/delete of the preference row, with the new consumption boundary.
Baseline checklist and reviewed text Course import keep their existing transactions.
The older presentation permission helper now also denies deferred automation mode.

Academic title hashes still cannot establish trusted import identity or a
last-import baseline; those rows are rejected as sources. Prediction fingerprints
detect changes in current state, but do not attest historical generation provenance;
prediction capabilities remain unregistered. Per-product source selection, complete
domain mutation semantics, cloud/binary provenance, and UI wiring belong to later
repair passes. See `docs/AI_TRUST_REPAIR_PASS1.md` for the exact certification scope.

Successful attempts retain informational provider/model/location/evidence/latency metadata, joined to original and edited review batches. Cloud latency is measured around the server request; local latency is null rather than invented. Local/remote provenance is labelled `browser_relay`, not hardware/model attestation. Cloud configuration status is not an online health claim. Routing rows retain metadata only, but existing course source text and reviewed proposal text remain in the protected audit; five-minute execution expiry does not delete them, and legacy history clearing does not purge these rows. No automatic retention job was introduced.

Academic automation contracts (Phases 7C–7E & 4B) are formalized:
- **Blackboard → Course Mapping (7C):** Frictionless manual mapping in `blackboard_course_mappings` referencing canonical `course_id`. Zero AI guessing for v1.
- **Blackboard → Task Automation (7C):** Three-stage pipeline (Event detected → Resolve course via saved mapping / Unassigned flow → Deterministic task creation/update linked to `course_id` → Optional AI enrichment). Deduplication via `(account_id, external_uid)`.
- **Course Materials & Task Links (7D):** Relational `task_course_material_links` (`task_id`, `course_material_id`) with course-scoped pickers.
- **AI Course Import Proposals (7E):** Text-readable document parsing producing reviewable Course Proposals (`[Create]`, `[Edit]`, `[Reject]`). Writes execute strictly via normal `createCourse` services.
- **Home Schedule & Next Class (4B):** Dynamic read projection from School `course_meetings` (Next Class card and Today timeline). Zero duplicate data source, no AI dependency.

Shared AES-256-GCM credential envelopes live in `src/services/integrations/credential.ts`; provider folders may re-export them for compatibility but must not depend on one another. Google Calendar begins read-only. Its server-only OAuth route uses a canonical `APP_ORIGIN`, exact callback URI, random state stored only as a SHA-256 hash, encrypted PKCE material, a ten-minute owner-scoped state row consumed by delete-and-return, offline access, and the narrow Calendar read-only scope. Callback messages expose only application-owned result codes. Access-token refresh uses an owner-scoped database lease, and provider sync uses a stable time-zone-aware horizon followed by encrypted incremental cursors. Expired cursors fall back to a full calendar sync; cancelled and missing records are retained as source-aware state rather than deleted. See `docs/GOOGLE_CALENDAR.md`.

Blackboard is limited to calendar-related information unless requirements change. Announcement, grade, messaging, document, and general feed syncing are out of scope.

Phase 2 accepts only a private Blackboard iCalendar URL. The URL is AES-256-GCM encrypted with a server-only deployment key and is never returned by status reads. Retrieval uses HTTPS with all-answer public-address DNS validation, a callback-shape-correct pinned lookup, manual validated redirects, time and size limits, and defensive parsing. `external_records` owns provider identity. Synchronization does not create or update ordinary tasks; it preserves any historical `task_id` link without acting on it and marks disappeared records missing rather than deleting them.

Phase 7A implements the Blackboard Assignment/Deadline proposal engine. It materializes one stable Universal Capture `create_task` proposal per stable Blackboard external record, keyed by the record rather than by each content revision. A separate semantic `proposal_revision` excludes provider timestamp/URL churn, while `content_hash` continues to audit every normalized source change. Unreviewed proposals refresh in place, a materially changed dismissed proposal reopens, and accepted-source changes never mutate or duplicate the native task. Confirmation extends the atomic capture commit/operation-batch path, validates that the reviewed source revision is current, and links the resulting task back to the external record. Full identity, lifecycle, temporal precision, deduplication, notification, schema, RLS, and implementation contracts follow `docs/FORWARD_ARCHITECTURE.md` section 7.

Phase 7A uses iCal UID, title, optional plain-text description, date/time, URL, and category values only. UID-less fallback identities fail closed (remain source mirrors only and never automatically create proposals). Offset-free/date-only values produce date precision (`due_date`) without invented UTC instants. Authenticated APIs, session extraction, undocumented endpoints, browser automation, and scraping remain a separate future security gate. The unused `announcements` table remains inert.

The Phase 8B Notion synchronization architecture gate is approved but unimplemented. It selects Redline-authoritative synchronization with per-note `forward_to_notion` or `selective_two_way` direction. Only title/body inside one explicitly tracked active Forward-managed Notion root participates; page content outside that root, native task/course links, and attachments remain provider-local. Unsupported content inside the managed root fails closed. Correctness uses versioned canonical semantic fingerprints against a last-common baseline; Notion revisions are observation/staleness hints, not change authority. Local-only changes use a staged remote-root generation swap, remote-only changes import atomically only for opted-in links, and genuine simultaneous changes persist three snapshots and pause for explicit Keep Redline/Use Notion resolution. Full identity, loop suppression, conflict, retry, deletion, schema, RLS, and UI contracts are in `docs/FORWARD_ARCHITECTURE.md` section 8.

Notion remains optional infrastructure. Native note autosave and offline replay commit first and only mark a durable link pending; provider failure never fails Notes. Phase 8B uses manual, note-open, bounded application-open reconciliation, plus a separate best-effort outbound debounce. It does not introduce webhook, cron, service-worker provider access, or a general job platform. The current `src/services/integrations/notion/provider-contract.ts` is a sketch and must be aligned to the approved persisted page/root identity and staged-write contract during implementation.

P3 external calendar mirrors use `external_calendar_accounts`, `external_calendars`, and `external_calendar_events`. Provider IDs, calendar IDs, event IDs, revisions, access mode, and declared capabilities remain explicit. Credential and incremental-sync token columns accept only encrypted envelopes; normal status and range reads never select them. Calendar renders connected, selected, non-missing provider events as fixed items with no native-event editor.

Notification events are a core Redline capability separate from parsing and domain data. They have persistent owner-scoped deduplication keys (`user_id, dedupe_key`) and safe relative deep links. The in-app Notification Center (`src/features/notifications/notification-center.tsx`) surfaces chronological updates across Tasks, Calendar, School, and Blackboard with server-persisted read/unread state, unread counts, and one-click actions. User notification preferences on `/more#notifications` and `/settings/notifications` control domain categories and quiet hours, with deliberate user-initiated Web Push enablement. An already-applied migration contains an unused `announcements` table; it is technical debt, not an active domain. Do not build Blackboard announcement behavior or scraping.

## Data layer

Supabase Auth and PostgreSQL hold the session plus task/native-event data. `src/services/supabase/request.ts` creates a fresh `@supabase/ssr` client for each request from secure cookies and the public project key. It verifies JWT claims before returning the authenticated subject. Normal repositories never receive or import the service-role client. `src/services/supabase/admin.ts` is a separately named, server-only maintenance boundary.

Root `proxy.ts` follows the Next.js 16 Proxy convention and refreshes Supabase cookies before rendering, including the private/no-store response headers required when auth cookies change. It does not make authorization decisions. The `(workspace)` layout is the route-level enforcement point, and repositories repeat authentication because Server Actions remain independently callable entry points.

`src/services/tasks/task-repository.ts` is the only module that speaks to the table. It maps snake_case rows to the camelCase `Task` type in `src/types/task.ts`, builds each view's query, and converts Postgres errors into `TaskRepositoryError` after logging the cause. Features never see a Supabase client.

Mutations run through server actions in `src/features/tasks/task-actions.ts`. Actions validate their own input because a server action is a public endpoint, return a discriminated `ActionResult` instead of throwing across the boundary, and call `revalidatePath` so server-rendered views refresh.

P2 Universal Capture follows the same request-client boundary in `src/services/captures/capture-repository.ts`. `captures.raw_content`, its kind, owner, and capture time are immutable evidence. Interpretations and proposals are separate owner-scoped rows. The initial deterministic interpreter derives an editable task title from the first useful text line; it does not call an AI provider.

Preparing a proposal and committing it are distinct operations. The commit RPC locks the capture and proposal, records explicit confirmation, creates the Inbox task and a server-authored inverse in one transaction, and then exposes a ten-minute undo window. Undo refuses to delete a task that has since changed or gained subtasks. Tasks remain tasks throughout this flow; no calendar-event row is created.

Phase 10A migration `20260831100000_ai_trust_boundary.sql` adds owner-readable `ai_requests`, an AI request link on operation batches, restrictive AI batch/step RLS write guards, a private signing-key schema, and narrow signed checklist RPCs. Request rows retain IDs, source revision, opaque handle, provider/model, capability, timestamps, and status; they do not retain prompts or descriptions. Validated checklist proposal text is intentionally retained in the owner-readable operation audit for review. Applied result IDs are stored in step metadata with `undo_supported: false`. Existing cloud-transfer history clearing does not delete this integrity-protected proposal audit. Automatic cleanup of abandoned AI request metadata is not yet implemented; source deletion remains allowed and makes subsequent review/apply unavailable.

Phase 7A reuses this transaction rather than introducing a Blackboard-specific task mutation. Its migration adds an owner-checked external-record relationship and semantic source revision to capture proposals, date precision and course relationships to normalized source data, and a nullable relational course on tasks. The extended commit locks the linked external record, rejects stale or missing-source confirmation, creates at most one task, and persists provenance in the proposal, external record, and operation step. Repeated unchanged synchronization does not create another capture, proposal, task, operation, or notification.

Data access stays server-side by default and exposes narrow operations to features. Do not create a large speculative schema. Add tables and constraints alongside the product phase that establishes their behavior.

`src/services/calendar-events/calendar-event-repository.ts` is the only module that speaks to `calendar_events`. Range reads use overlap semantics (`starts_at < rangeEnd` and `ends_at > rangeStart`) so multi-day events appear in every occupied local day. Browser creation is constrained to `source = life_os`; manual editing also permits `academic_calendar` while preserving protected source/external identity so reimport detects divergence. Other provider rows remain read-only.

`src/services/work-sessions/work-session-repository.ts` owns `task_work_sessions`. Each row has an owner-consistent task foreign key, a strict increasing instant range, a lifecycle status, and a manual-or-planner origin. New planning features should write sessions rather than adding more schedule columns to tasks.

`src/services/external-calendars/external-calendar-repository.ts` is the read boundary for external account status and visible event mirrors. Provider adapters will own synchronization writes after OAuth or credential setup. UI code consumes normalized projections and never receives provider SDK objects, encrypted credentials, or sync tokens.

## Task schema

`supabase/migrations` holds the SQL history. The `tasks` table carries owner `user_id`, `title`, `description`, `status`, `priority`, `due_date`, optional `due_at`, `scheduled_start`, `scheduled_end`, `area`, `project`, `course`, and the created, updated, and completed timestamps. `task_status` and `task_priority` are Postgres enums, so an unknown value fails at the database rather than silently persisting. `submitted` is distinct from `completed`: submission means the work was handed in, while completion remains the terminal Done state that owns `completed_at`.

Check constraints keep invalid states unrepresentable: a title cannot be blank, a scheduled end requires a start and cannot precede it, and `completed_at` is set exactly when the status is `completed`. A trigger maintains `updated_at`. Three indexes support the views: `(status, due_date)` for every dated view, `completed_at desc` for Completed, and a partial index on `scheduled_start` that the Phase 1D calendar range query will also use.

`scheduled_start` and `scheduled_end` remain a compatibility signal for existing task rows. P3 does not destructively migrate or invent missing interval ends; all new multi-session planning uses `task_work_sessions`.

`area`, `project`, and `course` are free text in this phase. Promoting them to their own tables is an additive migration: create the table, add a nullable foreign key, backfill from the text column, then drop the text column. Do not build those systems before their phases.

## Calendar-event schema

`calendar_events` stores owner `user_id`, `title`, `description`, `starts_at`, `ends_at`, `all_day`, `event_type`, `source`, `external_id`, `source_url`, optional `course`, and created/updated timestamps. `calendar_event_source` carries `life_os`, `blackboard`, `google_calendar`, and `academic_calendar`. The Academic Calendar source is owned by the Pass 2B adapter and uses `entry:<source-entry-id>` external identity. External identity is unique per owner and source when present. End is always strictly after start, and all-day intervals use an exclusive end instant.

`event_type` is constrained by native server-action validation rather than a database enum so future source adapters can preserve provider categories without changing the table. Course is free text until School establishes course metadata. Calendar item styling exposes a semantic per-item accent custom property; future course metadata may supply it without hard-coding course colors into Calendar components.

## Days, instants, and time zones

A due date is a calendar day, so `due_date` is a `date` and is compared as a `YYYY-MM-DD` string with no zone conversion. An explicitly timed deadline adds `due_at` as a `timestamptz`; it never borrows or invents a time from personal scheduling. A scheduled start or end is also a real instant, so both are `timestamptz`.

Deciding what "today" means therefore needs a zone. `src/lib/date/day.ts` resolves it from a valid `APP_TIME_ZONE`, falling back to `Asia/Manila` rather than the runtime's location, and converts a calendar day into the pair of UTC instants that bound it. Invalid calendar days and offset-free instants are rejected. Wall-clock conversion rejects nonexistent DST times and deterministically selects the earlier occurrence when a clock repeats. The page passes the resolved zone and today's date down as props so a row formats identically on the server and after hydration.

Calendar follows the same rule. Timed event and scheduled-task values are written as ISO instants and stored as `timestamptz`; `datetime-local` wall clocks are converted using the resolved workspace zone. All-day events are stored as half-open local-day boundaries (`[start, dayAfterEnd)`) converted to instants. Calendar queries use half-open ranges and local display converts instants back through the same zone. Deployments outside the default Manila workspace should set `APP_TIME_ZONE` to the intended IANA zone.

## Tasks are not calendar events

The task schema has no event foreign key, and nothing in the task write path creates a calendar-event row. Scheduling a task sets `scheduled_start` and `scheduled_end` on the task itself.

The dated task views combine both signals: a task reaches Today because its due date is today or because its scheduled start falls inside today. Calendar performs two task reads for a visible range: overlapping scheduled tasks and tasks whose deadline is in range. `buildCalendarItems` deduplicates the reads and delegates to the pure calendar-domain adapter. A task with both signals intentionally produces a scheduled work block and a separate deadline marker. Clicking either task presentation opens the original task editor, and task actions revalidate both `/tasks` and `/calendar`. This view model has no repository or write path, so it cannot create duplicate domain records.

## Phase 1F calendar domain contract

`src/features/calendar/calendar-domain.ts` is the shared mapping and rule layer for future Month, Week, Agenda, and Timetable interfaces. It projects source-aware native events, task deadlines, task schedules, and recurring course-meeting occurrences into a typed `CalendarEntry` union. Date-only task deadlines are all-day markers. Exact deadlines use `dueAt`. Scheduled entries always represent personal work time. A task may produce both representations without either one becoming a native event.

The default filter contract shows tasks, Submitted work, native events, course meetings, all-day entries, deadlines, and schedules, while hiding Done and cancelled tasks. Submitted and Done remain independently filterable. Submitted, Done, and cancelled tasks are not overdue. An open date-only task becomes overdue at the start of the next day in the display zone; an exact deadline becomes overdue only after its stored instant.

Task dragging uses `rescheduleTask` and the validating `rescheduleTaskAction`. `move_deadline` changes only the deadline and preserves an existing local due clock; `move_schedule` changes only the personal interval and preserves its duration. Neither operation performs an implicit conversion between a deadline and a work block.

Tasks and native events retain optional free-text course labels for compatibility. School also persists owner-scoped `courses` and `course_meetings`; the Calendar expands meetings as read-time occurrences instead of duplicating native-event rows. Archiving is not represented in the task schema, so the calendar does not claim task-archive behavior until that domain exists.

## Phase 6 Focus and Goldfish presentation contract

Focus / Goldfish Mode (`src/features/focus/focus-domain.ts` and `/focus`) is a pure, deterministic read-model and presentation layer answering: "What actually matters right now?" It does not create separate task tables, invent new statuses, mutate task records, or persist timer state.

The focus domain projects existing Tasks, Work Sessions, Native Calendar Events, External Calendar Mirrors, and Course Meetings into a zero-guilt, tri-level hierarchy:
- **NOW:** The currently active work session, active calendar commitment, imminent commitment (<=15m), or top deterministic actionable task (selected via priority/deadline semantics without AI).
- **NEXT:** The immediate chronologically upcoming scheduled work session, fixed meeting, or next priority task for today.
- **TODAY:** A filtered, deduplicated list of hard deadlines, upcoming sessions/commitments, and overdue items presented calmly ("Needs attention") without shame counters or red alerts.

Distant backlog items (undated inbox, someday tasks, future dates) and completed items are excluded from active presentation. Exiting Focus Mode returns seamlessly to the standard workspace without data alterations.

## Phase 8 Notion Knowledge Integration contract

Phase 8 (`src/services/integrations/notion/`) implements selective two-way note synchronization and outbound export with loop suppression, canonical AST normalization, and explicit conflict resolution.

Key contracts:
- **Authority**: Forward (Redline) is the authoritative operational master. Synchronization is opt-in per note (`forward_to_notion` or `selective_two_way`).
- **Remote Boundary**: Forward manages a single top-level toggle block containing a versioned marker `⚡ Forward Sync [link:<id>] [v:<version>] [attempt:<attempt>]`. Content outside the managed toggle belongs exclusively to Notion and is never overwritten or deleted.
- **Canonical AST**: Pure normalization between Redline Markdown and Notion Block DTOs (`heading_1`–`heading_3`, `paragraph`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `code`, `quote`). Unsupported blocks (e.g. databases, embeds, tables) fail closed with `unsupported_remote_content` and are never corrupted.
- **Loop Suppression**: Pure 4-state transition planner with deterministic SHA-256 fingerprinting, self-write echo suppression (`remote_fingerprint === last_pushed_fingerprint`), and independent converged edit recognition.
- **Safe Remote Writes**: Staged generation append, remote verify, atomic swap of `remote_root_block_id`, followed by old root archival.
- **Conflict Resolution**: Divergent concurrent edits create `notion_sync_conflicts` with 3-way snapshots (`base`, `local`, `remote`) and require explicit user resolution (`keep_redline` or `use_notion`).
- **Security & RLS**: All paths execute via `requireAuthenticatedSupabase()` using security-invoker RPCs (`notion_apply_remote_import`, `notion_resolve_conflict`, `notion_retire_link`). Credentials are encrypted with AES-256-GCM in `integration_accounts.encrypted_credential` and never sent to clients.

## Authentication

Supabase password authentication uses cookie-backed SSR sessions. `getClaims()` is the authoritative server check; local storage is not consulted. Missing and expired sessions redirect to `/login`, authenticated visits to `/login` return to the workspace, and provider outages fail closed at the public auth surface.

Both personal tables use a nullable-first `user_id uuid references auth.users(id)` migration, owner indexes, and separate select/insert/update/delete policies scoped to `authenticated`. `WITH CHECK ((select auth.uid()) = user_id)` prevents forged-owner inserts and ownership transfer. Anonymous users have no matching policy. Application writes also derive `user_id` from verified claims, but that filter is defense in depth rather than the security boundary.

Existing rows are preserved. A service-role-only RPC assigns only null owners atomically; a separate service-role-only finalizer verifies zero ownerless rows before setting `NOT NULL`. The operator supplies the environment-specific owner UUID at runtime, never through committed SQL. See `docs/SUPABASE_AUTH.md` for the staged procedure and recovery rules.

## Phase 4 Notification Center, Background Dispatch & Web Push Architecture

Phase 4 (`src/services/notifications/`, `src/features/notifications/`, and `/api/notifications/dispatch`) establishes a general, privacy-conscious notification system spanning Tasks, Calendar, School Course Meetings, and Blackboard synchronization.

### Pipeline Architecture

```text
Canonical Redline Data (Tasks, Calendar, School, Blackboard)
                         ↓
             Notification Planner / Evaluator
                         ↓
                notification_events
                         ↓
          Notification Delivery Dispatcher
                         ↓
              notification_deliveries
                         ↓
         Web Push Delivery (RFC 8291 / 8292)
                         ↓
            Browser / Installed iOS PWA
```

### Key Contracts:
- **General Redline Core**: School is a specialized domain; notifications are structured across tasks, calendar, school, blackboard, and system sync.
- **Maintained Web Push Adapter**: The server-only `web-push` package constructs RFC 8291 `aes128gcm` payload encryption and RFC 8292 VAPID requests. Registration and send-time validation allow only HTTPS endpoints for the supported browser push providers (FCM, Mozilla Autopush, Apple Web Push, and WNS); redirects, embedded credentials, custom ports, malformed receiver keys, and arbitrary hosts are rejected.
- **Quiet Hours & Source Reconciliation**: In-app notifications are created immediately. Web push deliveries are deferred (`status = 'deferred'`) during user quiet hours. Before a deferred or pending delivery leaves the server, the dispatcher rechecks the effective server-side preference, active subscription, semantic source revision, and staleness. Completed/rescheduled tasks, deleted/rescheduled calendar events, changed course meetings, dismissed/committed Blackboard proposals in the wrong lifecycle state, and expired transitory notifications become `unavailable` rather than producing a belated push.
- **At-Most-Once Claims & Dead Subscription Invalidation**: `notification_deliveries` tracks `pending`, `deferred`, `sending`, `sent`, `failed`, and `unavailable`. A conditional `pending → sending` database update prevents concurrent workers from sending the same row. Ambiguous network failures and stale claims are terminal failures rather than automatic retries, prioritizing duplicate suppression; the system is therefore best-effort with at-most-once send attempts, not guaranteed delivery. Push service HTTP 404/410 responses permanently disable `push_subscriptions.disabled_at = now()`, while 429, 5xx, timeouts, and network failures keep the subscription active.
- **Owner-Consistent Persistence**: RLS remains the browser-facing boundary. Relationship-owner triggers additionally ensure that devices, courses, events, subscriptions, and deliveries linked by a row belong to the same owner, including service-role writes.
- **Authenticated Dispatch Endpoint**: `/api/notifications/dispatch` accepts cron-secret GET/POST requests through `CRON_SECRET` or `NOTIFICATION_DISPATCH_SECRET`. An authenticated browser session may use POST only and can dispatch only its verified owner. Cron-secret dispatch uses the Supabase service-role client and the authenticated user registry. No automatic scheduler is committed; production must configure an HTTPS scheduler to call `GET /api/notifications/dispatch` with `Authorization: Bearer <CRON_SECRET>` on the chosen cadence.

## Tasks and calendar are separate domains

A task and a calendar event are different entities. A task may have a deadline or scheduled interval and may be rendered in a calendar view, but that rendering does not convert it into a standard calendar event. Calendar presentation should eventually consume a union or view model while persistence retains distinct task and event records.

External events remain source-aware so synchronization and updates can respect their provider. Blackboard calendar items must not automatically become normal tasks. Any explicit conversion or linking behavior requires its own later product decision.

## Principles to preserve

- Build only the current phase.
- Prefer server components until interaction requires a client boundary.
- Keep mobile behavior intentional and safe-area aware.
- Keep feature logic independent from palette and presentation themes.
- Reuse primitives and business rules instead of duplicating them.
- Add dependencies only for an immediate, concrete need.
- Keep integrations isolated and source-aware.
- Update this document when a material boundary changes.
- Run lint, TypeScript validation, and an appropriate production build before claiming meaningful work is complete.

### Gemini integration persistence extension (2026-08-31)

Migration `20260831110000_ai_reviewed_course_import.sql` adds the course source table, exclusive course/checklist batch links, a `course` audit target, and signed prepare/finalize/revise/read/reject/apply operations. A partial unique index permits only one proposed review per source; older revisions stay immutable and rejected. Restrictive batch/step policies also guard the course link even if a browser claims a non-AI source. **Course source text is intentionally persisted** with the integrity-protected review audit. It is not logged and is not cleared by the legacy cloud-history button; expiry blocks execution but does not erase content. No automatic retention job is implemented. Checklist requests still store only metadata/revision, not source descriptions.

Notification hardening from `1033efb` remains authoritative. The only production notification port from Gemini propagates one server evaluation instant through task/event/class planning, quiet-hours evaluation, subscription expiry, and in-app delivery timestamps. Push creation still uses `deferred` during quiet hours; Gemini’s unconditional `pending` change was rejected. Crypto, URL/SSRF checks, service-worker checks, dispatch authentication, and registry behavior are unchanged.
