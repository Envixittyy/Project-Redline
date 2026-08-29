# Architecture

## Goals

The repository is a deliberately small foundation for Forward, a personal, single-user application. It separates framework concerns, reusable interface code, feature ownership, and external systems without introducing speculative layers. Project Redline and existing `life_os` identifiers are historical/internal names, not architectural namespaces. Cross-phase contracts are indexed in `docs/FORWARD_ARCHITECTURE.md`.

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

Shared AES-256-GCM credential envelopes live in `src/services/integrations/credential.ts`; provider folders may re-export them for compatibility but must not depend on one another. Google Calendar begins read-only. Its server-only OAuth route uses a canonical `APP_ORIGIN`, exact callback URI, random state stored only as a SHA-256 hash, encrypted PKCE material, a ten-minute owner-scoped state row consumed by delete-and-return, offline access, and the narrow Calendar read-only scope. Callback messages expose only application-owned result codes. Access-token refresh uses an owner-scoped database lease, and provider sync uses a stable time-zone-aware horizon followed by encrypted incremental cursors. Expired cursors fall back to a full calendar sync; cancelled and missing records are retained as source-aware state rather than deleted. See `docs/GOOGLE_CALENDAR.md`.

Blackboard is limited to calendar-related information unless requirements change. Announcement, grade, messaging, document, and general feed syncing are out of scope.

Phase 2 accepts only a private Blackboard iCalendar URL. The URL is AES-256-GCM encrypted with a server-only deployment key and is never returned by status reads. Retrieval uses HTTPS with all-answer public-address DNS validation, a callback-shape-correct pinned lookup, manual validated redirects, time and size limits, and defensive parsing. `external_records` owns provider identity. Synchronization does not create or update ordinary tasks; it preserves any historical `task_id` link without acting on it and marks disappeared records missing rather than deleting them.

Phase 7A implements the Blackboard Assignment/Deadline proposal engine. It materializes one stable Universal Capture `create_task` proposal per stable Blackboard external record, keyed by the record rather than by each content revision. A separate semantic `proposal_revision` excludes provider timestamp/URL churn, while `content_hash` continues to audit every normalized source change. Unreviewed proposals refresh in place, a materially changed dismissed proposal reopens, and accepted-source changes never mutate or duplicate the native task. Confirmation extends the atomic capture commit/operation-batch path, validates that the reviewed source revision is current, and links the resulting task back to the external record. Full identity, lifecycle, temporal precision, deduplication, notification, schema, RLS, and implementation contracts follow `docs/FORWARD_ARCHITECTURE.md` section 7.

Phase 7A uses iCal UID, title, optional plain-text description, date/time, URL, and category values only. UID-less fallback identities fail closed (remain source mirrors only and never automatically create proposals). Offset-free/date-only values produce date precision (`due_date`) without invented UTC instants. Authenticated APIs, session extraction, undocumented endpoints, browser automation, and scraping remain a separate future security gate. The unused `announcements` table remains inert.

The Phase 8B Notion synchronization architecture gate is approved but unimplemented. It selects Redline-authoritative synchronization with per-note `forward_to_notion` or `selective_two_way` direction. Only title/body inside one explicitly tracked active Forward-managed Notion root participates; page content outside that root, native task/course links, and attachments remain provider-local. Unsupported content inside the managed root fails closed. Correctness uses versioned canonical semantic fingerprints against a last-common baseline; Notion revisions are observation/staleness hints, not change authority. Local-only changes use a staged remote-root generation swap, remote-only changes import atomically only for opted-in links, and genuine simultaneous changes persist three snapshots and pause for explicit Keep Redline/Use Notion resolution. Full identity, loop suppression, conflict, retry, deletion, schema, RLS, and UI contracts are in `docs/FORWARD_ARCHITECTURE.md` section 8.

Notion remains optional infrastructure. Native note autosave and offline replay commit first and only mark a durable link pending; provider failure never fails Notes. Phase 8B uses manual, note-open, bounded application-open reconciliation, plus a separate best-effort outbound debounce. It does not introduce webhook, cron, service-worker provider access, or a general job platform. The current `src/services/integrations/notion/provider-contract.ts` is a sketch and must be aligned to the approved persisted page/root identity and staged-write contract during implementation.

P3 external calendar mirrors use `external_calendar_accounts`, `external_calendars`, and `external_calendar_events`. Provider IDs, calendar IDs, event IDs, revisions, access mode, and declared capabilities remain explicit. Credential and incremental-sync token columns accept only encrypted envelopes; normal status and range reads never select them. Calendar renders connected, selected, non-missing provider events as fixed items with no native-event editor.

Notification events are separate from parsing and have persistent owner-scoped deduplication keys and safe relative deep links. Device subscriptions and delivery rows prepare standards-based Web Push; in-app events remain available when push is unavailable or fails. An already-applied migration contains an unused `announcements` table; it is technical debt, not an active domain. Do not build Blackboard announcement behavior or scraping.

## Data layer

Supabase Auth and PostgreSQL hold the session plus task/native-event data. `src/services/supabase/request.ts` creates a fresh `@supabase/ssr` client for each request from secure cookies and the public project key. It verifies JWT claims before returning the authenticated subject. Normal repositories never receive or import the service-role client. `src/services/supabase/admin.ts` is a separately named, server-only maintenance boundary.

Root `proxy.ts` follows the Next.js 16 Proxy convention and refreshes Supabase cookies before rendering, including the private/no-store response headers required when auth cookies change. It does not make authorization decisions. The `(workspace)` layout is the route-level enforcement point, and repositories repeat authentication because Server Actions remain independently callable entry points.

`src/services/tasks/task-repository.ts` is the only module that speaks to the table. It maps snake_case rows to the camelCase `Task` type in `src/types/task.ts`, builds each view's query, and converts Postgres errors into `TaskRepositoryError` after logging the cause. Features never see a Supabase client.

Mutations run through server actions in `src/features/tasks/task-actions.ts`. Actions validate their own input because a server action is a public endpoint, return a discriminated `ActionResult` instead of throwing across the boundary, and call `revalidatePath` so server-rendered views refresh.

P2 Universal Capture follows the same request-client boundary in `src/services/captures/capture-repository.ts`. `captures.raw_content`, its kind, owner, and capture time are immutable evidence. Interpretations and proposals are separate owner-scoped rows. The initial deterministic interpreter derives an editable task title from the first useful text line; it does not call an AI provider.

Preparing a proposal and committing it are distinct operations. The commit RPC locks the capture and proposal, records explicit confirmation, creates the Inbox task and a server-authored inverse in one transaction, and then exposes a ten-minute undo window. Undo refuses to delete a task that has since changed or gained subtasks. Tasks remain tasks throughout this flow; no calendar-event row is created.

Phase 7A reuses this transaction rather than introducing a Blackboard-specific task mutation. Its migration adds an owner-checked external-record relationship and semantic source revision to capture proposals, date precision and course relationships to normalized source data, and a nullable relational course on tasks. The extended commit locks the linked external record, rejects stale or missing-source confirmation, creates at most one task, and persists provenance in the proposal, external record, and operation step. Repeated unchanged synchronization does not create another capture, proposal, task, operation, or notification.

Data access stays server-side by default and exposes narrow operations to features. Do not create a large speculative schema. Add tables and constraints alongside the product phase that establishes their behavior.

`src/services/calendar-events/calendar-event-repository.ts` is the only module that speaks to `calendar_events`. Range reads use overlap semantics (`starts_at < rangeEnd` and `ends_at > rangeStart`) so multi-day events appear in every occupied local day. Native mutations are constrained to `source = life_os`; future integration adapters must own writes for their provider rows.

`src/services/work-sessions/work-session-repository.ts` owns `task_work_sessions`. Each row has an owner-consistent task foreign key, a strict increasing instant range, a lifecycle status, and a manual-or-planner origin. New planning features should write sessions rather than adding more schedule columns to tasks.

`src/services/external-calendars/external-calendar-repository.ts` is the read boundary for external account status and visible event mirrors. Provider adapters will own synchronization writes after OAuth or credential setup. UI code consumes normalized projections and never receives provider SDK objects, encrypted credentials, or sync tokens.

## Task schema

`supabase/migrations` holds the SQL history. The `tasks` table carries owner `user_id`, `title`, `description`, `status`, `priority`, `due_date`, optional `due_at`, `scheduled_start`, `scheduled_end`, `area`, `project`, `course`, and the created, updated, and completed timestamps. `task_status` and `task_priority` are Postgres enums, so an unknown value fails at the database rather than silently persisting. `submitted` is distinct from `completed`: submission means the work was handed in, while completion remains the terminal Done state that owns `completed_at`.

Check constraints keep invalid states unrepresentable: a title cannot be blank, a scheduled end requires a start and cannot precede it, and `completed_at` is set exactly when the status is `completed`. A trigger maintains `updated_at`. Three indexes support the views: `(status, due_date)` for every dated view, `completed_at desc` for Completed, and a partial index on `scheduled_start` that the Phase 1D calendar range query will also use.

`scheduled_start` and `scheduled_end` remain a compatibility signal for existing task rows. P3 does not destructively migrate or invent missing interval ends; all new multi-session planning uses `task_work_sessions`.

`area`, `project`, and `course` are free text in this phase. Promoting them to their own tables is an additive migration: create the table, add a nullable foreign key, backfill from the text column, then drop the text column. Do not build those systems before their phases.

## Calendar-event schema

`calendar_events` stores owner `user_id`, `title`, `description`, `starts_at`, `ends_at`, `all_day`, `event_type`, `source`, `external_id`, `source_url`, optional `course`, and created/updated timestamps. `calendar_event_source` prepares the stable identities `life_os`, `blackboard`, and `google_calendar`; only `life_os` has behavior in Phase 1D. External identity is unique per owner and source when present. End is always strictly after start, and all-day intervals use an exclusive end instant.

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
