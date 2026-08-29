<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository instructions

## Required reading before taking action

Before planning, modifying, or creating any files, every agent MUST completely read and obey:

1. `AGENTS.md` (these durable operational rules)
2. `docs/ROADMAP.md` (authoritative product roadmap, phase boundaries, and model review gates)
3. `docs/ARCHITECTURE.md` (current repository architecture and persistence contracts)
4. `docs/FORWARD_ARCHITECTURE.md` (future architecture contracts and authoritative liquid-glass visual direction)

Do not rely on assumptions or training-data defaults. Verify all constraints against the repository.

## Product rules

- This is a personal, single-user productivity and school operating system. Do NOT introduce multi-tenant, organizational, team, SaaS, or commercial complexity.
- Mobile, especially iPhone-sized displays, touch targets (≥44px), and standalone PWA usage, is a first-class platform.
- Do NOT build unspecified features or implement future phases opportunistically.
- Prefer the smallest clear architecture that supports the current phase.
- Forward (internal codename: Project Redline) is developed incrementally. Implement only functionality explicitly assigned to the current task.

## Navigation & visual system

- Planned primary mobile navigation is Home, Tasks, Calendar, School, and More. Desktop uses a persistent glass sidebar.
- Authoritative visual identity is deep, dimensional blue with liquid-glass surfaces and semantic design tokens (`src/styles/tokens.css`). Do NOT encode permanent hardcoded colors in feature components.
- Account for safe-area insets (`env(safe-area-inset-bottom)`), responsive layouts, and reduced motion (`data-motion`).

## Tasks and calendar separation

- Tasks and calendar events are separate entities.
- A task may have a deadline, have a scheduled time, or have multiple work sessions (`task_work_sessions`), and appear visually on a calendar. Rendering it on a calendar does NOT turn it into a native calendar event.
- External calendar events and Blackboard feed items must remain source-aware.
- Blackboard ingestion must NEVER automatically create standard application tasks. Newly detected school items must go through the Universal Capture proposal flow for user review.
- External calendar records must not be automatically converted into native tasks or native events.

## Blackboard & school scope

- Blackboard synchronization is limited to calendar-related information and reviewable task proposals.
- Do NOT build brittle web scraping, grade, messaging, or document synchronization.
- Unused `announcements` database table is inert technical debt.

## Deferred features (Not removed)

The following capabilities are explicitly deferred to later phases in `docs/ROADMAP.md` and must NOT be implemented prematurely:
- Recurring tasks and routine automation (Phase 11)
- Dashboard drag-and-drop customization and persistent custom layouts (Phase 12)
- Note interactive checklists and internal backlinks `[[wikilinks]]` (Phase 12)
- Football / East Football United secondary area (Phase 13)

## Engineering standards

- Inspect existing code and documentation before making architectural changes.
- Preserve existing behavior unless a requested change explicitly requires otherwise.
- Avoid unrelated modifications, duplicate components, duplicate business logic, giant utility files, and unnecessary dependencies.
- Prefer root-cause fixes and straightforward code over speculative abstraction.
- Keep reusable UI in `src/components`; keep feature-specific UI and logic in `src/features`.
- Isolate external systems behind `src/services/integrations` boundaries.
- Never expose secrets or commit populated local environment files.
- Update `docs/ARCHITECTURE.md` when current architecture changes materially.
- Prefer modern Next.js 16 App Router conventions and Server Components by default. Add client components only where browser APIs or local interactivity require them.
- Before editing, inspect relevant files and existing patterns. After editing, inspect the diff and remove dead code.

## Validation

For meaningful changes, run:

1. `pnpm lint`
2. `pnpm typecheck`
3. Relevant tests, when tests exist (`pnpm test`)
4. `pnpm build` when production behavior may be affected

Never claim a check passed unless it was actually run.

## Completion reports

For substantial tasks, report what changed, important files, architecture decisions, dependencies, verification performed, known limitations, and considerations for the next phase. Never silently continue into a later development phase.
